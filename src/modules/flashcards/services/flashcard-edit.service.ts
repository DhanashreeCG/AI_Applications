import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getErrorMessage } from '../../../common/utils/error-message';
import {
  PIPELINE_STAGES,
  PipelineTelemetryContext,
} from '../../../common/events/pipeline-tracker.events';
import { assertGenerationRequestAllowed } from '../../../common/content-safety/assert-user-query';
import { FLASHCARD_WORKFLOW_EDIT } from '../constants/flashcard.constants';
import { EditFlashcardDto } from '../dto/edit-flashcard.dto';
import { SaveFlashcardEditsDto } from '../dto/save-flashcards.dto';
import { FlashcardException } from '../errors/flashcard.exception';
import {
  AssetReference,
  GenerateFlashcardsResponse,
  ImageSearchQuery,
} from '../interfaces/flashcard.interfaces';
import {
  FlashcardPipelineEmitter,
  createTelemetryContext,
} from '../telemetry/flashcard-pipeline.events';
import {
  cloneCards,
  findCard,
  findComponent,
} from '../utils/flashcard-cards.util';
import { FlashcardContentService } from './flashcard-content.service';
import { FlashcardImageRetrievalService } from './flashcard-image-retrieval.service';
import { FlashcardPersistenceService } from './flashcard-persistence.service';

@Injectable()
export class FlashcardEditService {
  private readonly logger = new Logger(FlashcardEditService.name);
  private readonly emitter: FlashcardPipelineEmitter;

  constructor(
    private readonly persistence: FlashcardPersistenceService,
    private readonly contentService: FlashcardContentService,
    private readonly imageRetrievalService: FlashcardImageRetrievalService,
    eventEmitter: EventEmitter2,
  ) {
    this.emitter = new FlashcardPipelineEmitter(eventEmitter);
  }

  public async edit(
    flashcardSetId: string,
    dto: EditFlashcardDto,
    options: { correlationId?: string } = {},
  ): Promise<GenerateFlashcardsResponse> {
    const telemetry = createTelemetryContext({
      correlationId: options.correlationId,
      workflowType: FLASHCARD_WORKFLOW_EDIT,
    });
    this.emitter.emitStarted({
      ...telemetry,
      metadata: {
        operation: 'edit',
        flashcardSetId,
        cardId: dto.cardId,
        componentId: dto.componentId,
      },
    });
    try {
      const response = await this.runEdit(flashcardSetId, dto, telemetry);
      this.emitter.emitCompleted({
        ...telemetry,
        status: 'completed',
        metadata: { flashcardSetId: response.id },
      });
      return response;
    } catch (error) {
      this.emitter.emitFailed({
        ...telemetry,
        status: 'failed',
        errorMessage: getErrorMessage(error),
      });
      throw error;
    }
  }

  private async runEdit(
    flashcardSetId: string,
    dto: EditFlashcardDto,
    telemetry: PipelineTelemetryContext,
  ): Promise<GenerateFlashcardsResponse> {
    const cardId = dto.cardId?.trim();
    const componentId = dto.componentId?.trim();
    const instruction = dto.instruction?.trim();
    if (!cardId || !componentId || !instruction) {
      throw new FlashcardException(
        'INVALID_FIELD',
        'cardId, componentId, and instruction are required',
      );
    }

    const current = await this.persistence.getById(flashcardSetId);
    const cards = cloneCards(current.cards);
    const card = findCard(cards, cardId);
    if (!card) {
      throw new FlashcardException(
        'INVALID_FIELD',
        `Card "${cardId}" was not found`,
      );
    }
    const component = findComponent(card, componentId);
    if (!component) {
      throw new FlashcardException(
        'INVALID_FIELD',
        `Component "${componentId}" was not found on card "${cardId}"`,
      );
    }
    if (!component.editable) {
      throw new FlashcardException(
        'FIELD_NOT_EDITABLE',
        `Component "${componentId}" is not editable`,
      );
    }

    assertGenerationRequestAllowed({
      query: instruction,
      countryCode: dto.countryCode,
    });

    this.emitter.emitStageStarted({
      ...telemetry,
      stageName: PIPELINE_STAGES.LLM_CONTENT_GENERATION,
    });
    const replacement = await this.contentService.generateFieldReplacement({
      instruction,
      cardId,
      componentId,
      componentType: component.componentType,
      currentValue:
        component.componentType === 'image'
          ? component.assetReference?.queryUsed ?? null
          : component.content,
      card,
      countryCode: dto.countryCode,
      telemetry,
    });
    this.emitter.emitStageCompleted({
      ...telemetry,
      stageName: PIPELINE_STAGES.LLM_CONTENT_GENERATION,
    });

    if (component.componentType === 'image') {
      const query = this.asImageQuery(replacement, component.assetReference);
      const assetReference = await this.imageRetrievalService.retrieveForCard({
        queries: [query],
        topic: current.request.topic,
        ageMin: current.request.ageMin,
        ageMax: current.request.ageMax,
        countryCode: dto.countryCode ?? current.request.countryCode ?? undefined,
      });
      component.assetReference = assetReference;
      component.content = null;
    } else {
      if (typeof replacement !== 'string') {
        throw new FlashcardException(
          'INVALID_LLM_OUTPUT',
          'Edited text component must be a string',
        );
      }
      component.content = replacement;
    }

    return this.persistence.updateCards(flashcardSetId, cards);
  }

  public async saveEdits(
    flashcardSetId: string,
    dto: SaveFlashcardEditsDto,
  ): Promise<GenerateFlashcardsResponse> {
    const current = await this.persistence.getById(flashcardSetId);
    const cards = cloneCards(current.cards);

    for (const field of dto.fields ?? []) {
      const card = findCard(cards, field.cardId?.trim());
      const component = card
        ? findComponent(card, field.componentId?.trim())
        : undefined;
      if (!card || !component) {
        this.logger.debug(
          `save skipped missing field ${field.cardId}.${field.componentId}`,
        );
        continue;
      }
      if (component.componentType === 'image') {
        continue;
      }
      if (typeof field.value === 'string') {
        component.content = field.value;
      }
    }

    for (const image of dto.images ?? []) {
      const card = findCard(cards, image.cardId?.trim());
      const component = card
        ? findComponent(card, image.componentId?.trim())
        : undefined;
      if (!card || !component || component.componentType !== 'image') {
        continue;
      }
      if (image.userUploadedKey?.trim()) {
        component.assetReference = this.imageRetrievalService.applyUserUploadedImage(
          component.assetReference,
          {
            key: image.userUploadedKey.trim(),
            imageUrl: `/flashcards/${flashcardSetId}/uploads/${this.uploadIdFromKey(image.userUploadedKey.trim())}/image`,
            contentType: component.assetReference?.mimeType || 'image/jpeg',
          },
        );
        continue;
      }
      if (image.assetId?.trim()) {
        component.assetReference =
          await this.imageRetrievalService.resolveLibraryAsset(
            image.assetId.trim(),
            component.assetReference?.queryUsed ?? '',
          );
      }
    }

    return this.persistence.updateCards(flashcardSetId, cards);
  }

  public async searchLibrary(
    options: { query?: string; limit?: number; countryCode?: string },
  ): Promise<{
    query: string;
    results: Array<{
      assetId: string;
      caption: string;
      searchDescription: string;
      imageUrl: string;
    }>;
  }> {
    const query = options.query?.trim() || '';
    if (!query) {
      throw new FlashcardException(
        'INVALID_REQUEST',
        'Provide query',
      );
    }
    const results = await this.imageRetrievalService.searchCandidates(
      query,
      options.limit,
      options.countryCode,
    );
    return { query, results };
  }

  public async searchImages(
    flashcardSetId: string,
    options: {
      query?: string;
      cardId?: string;
      componentId?: string;
      limit?: number;
      countryCode?: string;
    },
  ): Promise<{
    query: string;
    results: Array<{
      assetId: string;
      caption: string;
      searchDescription: string;
      imageUrl: string;
    }>;
  }> {
    const current = await this.persistence.getById(flashcardSetId);
    let query = options.query?.trim() || '';
    if (!query && options.cardId && options.componentId) {
      const card = findCard(current.cards, options.cardId.trim());
      const component = card
        ? findComponent(card, options.componentId.trim())
        : undefined;
      query = component?.assetReference?.queryUsed?.trim() || '';
    }
    if (!query) {
      throw new FlashcardException(
        'INVALID_REQUEST',
        'Provide query or a cardId and componentId whose slot has a search query',
      );
    }
    const results = await this.imageRetrievalService.searchCandidates(
      query,
      options.limit,
      options.countryCode,
    );
    return { query, results };
  }

  public async uploadImage(
    flashcardSetId: string,
    cardId: string,
    componentId: string,
    file: { buffer: Buffer; mimetype?: string; originalname?: string; size?: number },
  ) {
    const current = await this.persistence.getById(flashcardSetId);
    const card = findCard(current.cards, cardId.trim());
    const component = card ? findComponent(card, componentId.trim()) : undefined;
    if (!card || !component || component.componentType !== 'image') {
      throw new FlashcardException(
        'INVALID_FIELD',
        'cardId and componentId must point to an image component',
      );
    }
    const uploaded = await this.imageRetrievalService.uploadUserImage(
      flashcardSetId,
      file,
    );
    return {
      cardId: card.cardId,
      componentId: component.componentId,
      userUploadedKey: uploaded.key,
      imageUrl: uploaded.imageUrl,
      contentType: uploaded.contentType,
    };
  }

  public async loadUserUpload(flashcardSetId: string, uploadId: string) {
    await this.persistence.requireSet(flashcardSetId);
    return this.imageRetrievalService.loadUserUpload(flashcardSetId, uploadId);
  }

  private asImageQuery(
    replacement: unknown,
    previous: AssetReference | null | undefined,
  ): ImageSearchQuery | string {
    if (typeof replacement === 'string' && replacement.trim()) {
      return replacement.trim();
    }
    if (replacement && typeof replacement === 'object') {
      const record = replacement as Record<string, unknown>;
      const searchQuery =
        typeof record.searchQuery === 'string'
          ? record.searchQuery
          : typeof record.value === 'string'
            ? record.value
            : '';
      if (searchQuery.trim()) {
        return {
          searchQuery: searchQuery.trim(),
          expectedObjects: Array.isArray(record.expectedObjects)
            ? (record.expectedObjects as string[])
            : [],
        };
      }
    }
    return previous?.queryUsed || '';
  }

  private uploadIdFromKey(key: string): string {
    const slash = key.lastIndexOf('/');
    return slash >= 0 ? key.slice(slash + 1) : key;
  }
}

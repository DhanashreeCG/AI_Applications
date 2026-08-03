import { HttpStatus, Injectable } from '@nestjs/common';
import { DEFAULT_FLASHCARD_COUNT } from '../constants/flashcard.constants';
import { GenerateFlashcardsDto } from '../dto/generate-flashcards.dto';
import { FlashcardException } from '../errors/flashcard.exception';
import {
  EditableComponentPayload,
  FlashcardCardPayload,
  GenerateFlashcardsResponse,
  TemplateComponentDefinition,
} from '../interfaces/flashcard.interfaces';
import { parseEditableComponents } from '../utils/llm-content.validator';
import { resolveUserRequest } from '../utils/user-request.resolver';
import { FlashcardContentService } from './flashcard-content.service';
import { FlashcardImageRetrievalService } from './flashcard-image-retrieval.service';
import { TemplateSelectionService } from './template-selection.service';

@Injectable()
export class FlashcardOrchestratorService {
  constructor(
    private readonly templateSelectionService: TemplateSelectionService,
    private readonly contentService: FlashcardContentService,
    private readonly imageRetrievalService: FlashcardImageRetrievalService,
  ) {}

  public async generate(
    dto: GenerateFlashcardsDto,
  ): Promise<GenerateFlashcardsResponse> {
    const count = dto.count ?? DEFAULT_FLASHCARD_COUNT;
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      throw new FlashcardException(
        'INVALID_REQUEST',
        'count must be an integer between 1 and 20',
        HttpStatus.BAD_REQUEST,
      );
    }

    const resolved = resolveUserRequest({
      query: dto.query,
      ageGroup: dto.ageGroup,
    });

    const selected = await this.templateSelectionService.select({
      topic: resolved.topic,
      ageMin: resolved.ageMin,
      ageMax: resolved.ageMax,
      learningObjective: resolved.learningObjective,
      query: resolved.query,
    });

    const editableComponents = parseEditableComponents(
      selected.template.editableComponents,
    );
    const textComponents = editableComponents.filter(
      (component) => component.componentType !== 'image',
    );
    const imageComponents = editableComponents.filter(
      (component) => component.componentType === 'image',
    );

    const llmPayload = await this.contentService.generateContent({
      query: resolved.query,
      topic: resolved.topic,
      ageMin: selected.ageMin,
      ageMax: selected.ageMax,
      learningObjective: selected.learningObjective,
      count,
      textComponents,
    });

    const usedAssetIds = new Set<string>();
    const cards = await this.imageRetrievalService.mapWithConcurrency(
      llmPayload.cards,
      async (card): Promise<FlashcardCardPayload> => {
        const assetReference =
          await this.imageRetrievalService.retrieveForCard({
            queries: card.imageSearchQueries,
            ageMin: selected.ageMin,
            ageMax: selected.ageMax,
            usedAssetIds,
          });

        const components: EditableComponentPayload[] = editableComponents.map(
          (definition) =>
            this.mergeComponent(
              definition,
              card.components,
              imageComponents,
              assetReference,
            ),
        );

        return {
          cardIndex: card.cardIndex,
          components,
        };
      },
    );

    return {
      request: {
        query: resolved.query,
        topic: resolved.topic,
        ageGroup: resolved.ageGroup,
        ageMin: selected.ageMin,
        ageMax: selected.ageMax,
        learningObjective: selected.learningObjective,
        count,
      },
      selection: {
        ruleId: selected.selection.ruleId,
        ruleName: selected.selection.ruleName,
        score: selected.selection.score,
        priority: selected.selection.priority,
      },
      template: selected.template,
      cards,
      renderingMetadata: {
        generatedAt: new Date().toISOString(),
        promptVersion: this.contentService.getPromptVersion(),
        contentModel: this.contentService.getModelName(),
        imageConcurrency: this.imageRetrievalService.getConcurrency(),
      },
    };
  }

  private mergeComponent(
    definition: TemplateComponentDefinition,
    contentById: Record<string, string>,
    imageComponents: TemplateComponentDefinition[],
    assetReference: EditableComponentPayload['assetReference'],
  ): EditableComponentPayload {
    if (definition.componentType === 'image') {
      const isPrimaryImage =
        imageComponents[0]?.componentId === definition.componentId;
      return {
        componentId: definition.componentId,
        componentType: definition.componentType,
        editable: definition.editable,
        content: null,
        validationRules: definition.validationRules,
        assetReference: isPrimaryImage ? assetReference : null,
      };
    }

    return {
      componentId: definition.componentId,
      componentType: definition.componentType,
      editable: definition.editable,
      content: contentById[definition.componentId] ?? null,
      validationRules: definition.validationRules,
    };
  }
}

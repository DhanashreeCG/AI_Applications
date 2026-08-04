import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getErrorMessage } from '../../../common/utils/error-message';
import {
  PIPELINE_STAGES,
  PipelineTelemetryContext,
} from '../../../common/events/pipeline-tracker.events';
import { DEFAULT_FLASHCARD_COUNT } from '../constants/flashcard.constants';
import { GenerateFlashcardsDto } from '../dto/generate-flashcards.dto';
import { FlashcardException } from '../errors/flashcard.exception';
import {
  EditableComponentPayload,
  FlashcardCardPayload,
  GenerateFlashcardsResponse,
  TemplateComponentDefinition,
} from '../interfaces/flashcard.interfaces';
import { parseEditableComponentsFromLayout } from '../utils/template-layout.util';
import { resolveUserRequest } from '../utils/user-request.resolver';
import {
  FlashcardPipelineEmitter,
  createTelemetryContext,
} from '../telemetry/flashcard-pipeline.events';
import { FlashcardContentService } from './flashcard-content.service';
import { FlashcardImageRetrievalService } from './flashcard-image-retrieval.service';
import { TemplateSelectionService } from './template-selection.service';

export interface GenerateFlashcardsOptions {
  correlationId?: string;
}

@Injectable()
export class FlashcardOrchestratorService {
  private readonly logger = new Logger(FlashcardOrchestratorService.name);
  private readonly emitter: FlashcardPipelineEmitter;
  private readonly workflowType: string;

  constructor(
    private readonly templateSelectionService: TemplateSelectionService,
    private readonly contentService: FlashcardContentService,
    private readonly imageRetrievalService: FlashcardImageRetrievalService,
    private readonly configService: ConfigService,
    eventEmitter: EventEmitter2,
  ) {
    this.emitter = new FlashcardPipelineEmitter(eventEmitter);
    this.workflowType =
      this.configService.get<string>('pipelineTracking.workflowDefault') ||
      'flashcards';
  }

  public async generate(
    dto: GenerateFlashcardsDto,
    options: GenerateFlashcardsOptions = {},
  ): Promise<GenerateFlashcardsResponse> {
    const telemetry = createTelemetryContext({
      correlationId: options.correlationId,
      workflowType: this.workflowType,
    });

    this.emitter.emitStarted({
      ...telemetry,
      metadata: {
        query: dto.query,
        ageGroup: dto.ageGroup,
        grade: dto.grade,
        count: dto.count ?? DEFAULT_FLASHCARD_COUNT,
      },
    });

    try {
      const response = await this.runGenerate(dto, telemetry);
      this.emitter.emitCompleted({
        ...telemetry,
        status: 'completed',
        metadata: {
          topic: response.request.topic,
          ageGroup: response.request.ageGroup,
          grade: response.request.grade,
          templateId: response.template.id,
          learningObjective: response.request.learningObjective,
          cardCount: response.cards.length,
        },
      });

      this.emitter.emitStageStarted({
        ...telemetry,
        stageName: PIPELINE_STAGES.RESPONSE_RETURN,
      });
      this.emitter.emitStageCompleted({
        ...telemetry,
        stageName: PIPELINE_STAGES.RESPONSE_RETURN,
      });

      return {
        ...response,
        metadata: {
          ...response.metadata,
          requestId: telemetry.requestId,
          executionId: telemetry.executionId,
          correlationId: telemetry.correlationId,
        },
        renderingMetadata: {
          ...response.renderingMetadata,
          requestId: telemetry.requestId,
          executionId: telemetry.executionId,
          correlationId: telemetry.correlationId,
        },
      };
    } catch (error) {
      this.emitter.emitFailed({
        ...telemetry,
        status: 'failed',
        errorMessage: getErrorMessage(error),
      });
      throw error;
    }
  }

  private async runGenerate(
    dto: GenerateFlashcardsDto,
    telemetry: PipelineTelemetryContext,
  ): Promise<GenerateFlashcardsResponse> {
    this.emitter.emitStageStarted({
      ...telemetry,
      stageName: PIPELINE_STAGES.REQUEST_VALIDATION,
    });
    const count = dto.count ?? DEFAULT_FLASHCARD_COUNT;
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      this.emitter.emitStageFailed({
        ...telemetry,
        stageName: PIPELINE_STAGES.REQUEST_VALIDATION,
        errorMessage: 'count must be an integer between 1 and 20',
      });
      throw new FlashcardException(
        'INVALID_REQUEST',
        'count must be an integer between 1 and 20',
        HttpStatus.BAD_REQUEST,
      );
    }
    this.emitter.emitStageCompleted({
      ...telemetry,
      stageName: PIPELINE_STAGES.REQUEST_VALIDATION,
    });

    this.emitter.emitStageStarted({
      ...telemetry,
      stageName: PIPELINE_STAGES.REQUEST_ANALYSIS,
    });

    let resolved;
    try {
      resolved = resolveUserRequest({
        query: dto.query,
        ageGroup: dto.ageGroup,
        grade: dto.grade,
        subject: dto.subject,
        difficulty: dto.difficulty,
        language: dto.language,
      });
    } catch (error) {
      this.emitter.emitStageFailed({
        ...telemetry,
        stageName: PIPELINE_STAGES.REQUEST_ANALYSIS,
        errorMessage: getErrorMessage(error),
      });
      throw error;
    }

    this.emitter.emitStageCompleted({
      ...telemetry,
      stageName: PIPELINE_STAGES.REQUEST_ANALYSIS,
      metadata: {
        topic: resolved.topic,
        ageGroup: resolved.ageGroup,
        grade: resolved.grade,
        subject: resolved.subject,
        difficulty: resolved.difficulty,
        language: resolved.language,
      },
    });

    this.emitter.emitStageStarted({
      ...telemetry,
      stageName: PIPELINE_STAGES.EDUCATIONAL_OBJECTIVE_DETERMINATION,
    });
    this.emitter.emitStageCompleted({
      ...telemetry,
      stageName: PIPELINE_STAGES.EDUCATIONAL_OBJECTIVE_DETERMINATION,
      metadata: {
        learningObjective: resolved.learningObjective,
        educationalIntent: resolved.educationalIntent,
      },
    });

    const selected = await this.selectTemplateWithRetry(resolved, telemetry);

    const editableComponents = parseEditableComponentsFromLayout(
      selected.template.layoutDefinition,
    );
    const textComponents = editableComponents.filter(
      (component) => component.componentType !== 'image',
    );
    const imageComponents = editableComponents.filter(
      (component) => component.componentType === 'image',
    );

    const llmPayload = await this.contentService.generateContent(
      {
        query: resolved.query,
        topic: resolved.topic,
        ageMin: selected.ageMin,
        ageMax: selected.ageMax,
        learningObjective: selected.learningObjective,
        count,
        textComponents,
        grade: resolved.grade,
        subject: resolved.subject,
        difficulty: resolved.difficulty,
        language: resolved.language,
      },
      telemetry,
    );

    this.emitter.emitStageStarted({
      ...telemetry,
      stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
    });

    const usedAssetIds = new Set<string>();
    const cards = await this.imageRetrievalService.mapWithConcurrency(
      llmPayload.cards,
      async (card): Promise<FlashcardCardPayload> => {
        const imageRefs = await this.imageRetrievalService.mapWithConcurrency(
          imageComponents,
          async (imageDef, imageIndex) => {
            const query =
              card.imageSearchQueries[imageIndex] ??
              card.imageSearchQueries[0];
            return this.imageRetrievalService.retrieveForCard(
              {
                queries: query ? [query] : [],
                topic: resolved.topic,
                ageMin: selected.ageMin,
                ageMax: selected.ageMax,
                usedAssetIds,
              },
              telemetry,
            );
          },
        );

        const components: EditableComponentPayload[] = editableComponents.map(
          (definition) =>
            this.mergeComponent(
              definition,
              card.components,
              imageComponents,
              imageRefs,
            ),
        );

        return {
          cardId: `card-${card.cardIndex}`,
          cardIndex: card.cardIndex,
          components,
        };
      },
    );

    this.emitter.emitStageCompleted({
      ...telemetry,
      stageName: PIPELINE_STAGES.IMAGE_RETRIEVAL,
      metadata: { cardCount: cards.length },
    });

    this.emitter.emitStageStarted({
      ...telemetry,
      stageName: PIPELINE_STAGES.RESPONSE_ASSEMBLY,
    });

    const metadata = {
      generatedAt: new Date().toISOString(),
      promptVersion: this.contentService.getPromptVersion(),
      contentModel: this.contentService.getModelName(),
      imageConcurrency: this.imageRetrievalService.getConcurrency(),
    };

    const response: GenerateFlashcardsResponse = {
      request: {
        query: resolved.query,
        topic: resolved.topic,
        ageGroup: resolved.ageGroup,
        ageMin: selected.ageMin,
        ageMax: selected.ageMax,
        grade: resolved.grade,
        subject: resolved.subject,
        difficulty: resolved.difficulty,
        language: resolved.language,
        learningObjective: selected.learningObjective,
        educationalIntent: resolved.educationalIntent,
        count,
      },
      selection: {
        ruleId: selected.selection.ruleId,
        ruleName: selected.selection.ruleName,
        score: selected.selection.score,
        priority: selected.selection.priority,
      },
      template: selected.template,
      templateVersion: selected.template.templateVersion,
      layoutDefinition: selected.template.layoutDefinition,
      cards,
      metadata,
      renderingMetadata: metadata,
    };

    this.emitter.emitStageCompleted({
      ...telemetry,
      stageName: PIPELINE_STAGES.RESPONSE_ASSEMBLY,
    });

    this.emitter.emitStageStarted({
      ...telemetry,
      stageName: PIPELINE_STAGES.FINAL_VALIDATION,
    });
    this.assertFinalResponse(response, count, editableComponents);
    this.emitter.emitStageCompleted({
      ...telemetry,
      stageName: PIPELINE_STAGES.FINAL_VALIDATION,
    });

    return response;
  }

  private async selectTemplateWithRetry(
    resolved: ReturnType<typeof resolveUserRequest>,
    telemetry: PipelineTelemetryContext,
  ) {
    this.emitter.emitStageStarted({
      ...telemetry,
      stageName: PIPELINE_STAGES.TEMPLATE_SELECTION,
    });

    const selectOnce = () =>
      this.templateSelectionService.select({
        topic: resolved.topic,
        ageMin: resolved.ageMin,
        ageMax: resolved.ageMax,
        learningObjective: resolved.learningObjective,
        grade: resolved.grade,
        subject: resolved.subject,
        difficulty: resolved.difficulty,
        query: resolved.query,
      });

    try {
      const selected = await selectOnce();
      this.emitter.emitStageCompleted({
        ...telemetry,
        stageName: PIPELINE_STAGES.TEMPLATE_SELECTION,
        metadata: {
          templateId: selected.template.id,
          ruleId: selected.selection.ruleId,
          templateVersion: selected.template.templateVersion,
        },
      });
      return selected;
    } catch (error) {
      if (
        error instanceof FlashcardException &&
        error.code === 'TEMPLATE_VERSION_MISMATCH'
      ) {
        this.logger.warn(
          `Template became inactive during selection; retrying selection: ${getErrorMessage(error)}`,
        );
        try {
          const selected = await selectOnce();
          this.emitter.emitStageCompleted({
            ...telemetry,
            stageName: PIPELINE_STAGES.TEMPLATE_SELECTION,
            metadata: {
              templateId: selected.template.id,
              ruleId: selected.selection.ruleId,
              retriedAfterInactive: true,
            },
          });
          return selected;
        } catch (retryError) {
          this.emitter.emitStageFailed({
            ...telemetry,
            stageName: PIPELINE_STAGES.TEMPLATE_SELECTION,
            errorMessage: getErrorMessage(retryError),
          });
          throw retryError;
        }
      }

      this.emitter.emitStageFailed({
        ...telemetry,
        stageName: PIPELINE_STAGES.TEMPLATE_SELECTION,
        errorMessage: getErrorMessage(error),
      });
      throw error;
    }
  }

  private assertFinalResponse(
    response: GenerateFlashcardsResponse,
    count: number,
    editableComponents: TemplateComponentDefinition[],
  ): void {
    if (!Array.isArray(response.cards) || response.cards.length !== count) {
      throw new FlashcardException(
        'INVALID_LLM_OUTPUT',
        'Assembled flashcard response failed validation',
      );
    }

    const allowedIds = new Set(
      editableComponents.map((component) => component.componentId),
    );

    for (const card of response.cards) {
      for (const component of card.components) {
        if (!allowedIds.has(component.componentId)) {
          throw new FlashcardException(
            'INVALID_LLM_OUTPUT',
            `Assembled card has unsupported component "${component.componentId}"`,
          );
        }
      }
      if (card.components.length !== editableComponents.length) {
        throw new FlashcardException(
          'INVALID_LLM_OUTPUT',
          'Assembled card component count does not match template',
        );
      }
    }
  }

  private mergeComponent(
    definition: TemplateComponentDefinition,
    contentById: Record<string, string>,
    imageComponents: TemplateComponentDefinition[],
    imageRefs: Array<EditableComponentPayload['assetReference']>,
  ): EditableComponentPayload {
    if (definition.componentType === 'image') {
      const imageIndex = imageComponents.findIndex(
        (component) => component.componentId === definition.componentId,
      );
      const assetReference =
        imageIndex >= 0 ? (imageRefs[imageIndex] ?? null) : null;
      return {
        componentId: definition.componentId,
        type: definition.componentType,
        componentType: definition.componentType,
        editable: definition.editable,
        content: null,
        validationRules: definition.validationRules,
        assetReference,
      };
    }

    return {
      componentId: definition.componentId,
      type: definition.componentType,
      componentType: definition.componentType,
      editable: definition.editable,
      content: contentById[definition.componentId] ?? null,
      validationRules: definition.validationRules,
    };
  }
}

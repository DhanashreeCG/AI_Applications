import { HttpStatus, Injectable } from '@nestjs/common';
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
          templateId: response.template.id,
          learningObjective: response.request.learningObjective,
          cardCount: response.cards.length,
        },
      });
      return {
        ...response,
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
      stageName: PIPELINE_STAGES.AGE_IDENTIFICATION,
    });
    this.emitter.emitStageStarted({
      ...telemetry,
      stageName: PIPELINE_STAGES.LEARNING_OBJECTIVE_SELECTION,
    });

    let resolved;
    try {
      resolved = resolveUserRequest({
        query: dto.query,
        ageGroup: dto.ageGroup,
      });
    } catch (error) {
      this.emitter.emitStageFailed({
        ...telemetry,
        stageName: PIPELINE_STAGES.AGE_IDENTIFICATION,
        errorMessage: getErrorMessage(error),
      });
      throw error;
    }

    this.emitter.emitStageCompleted({
      ...telemetry,
      stageName: PIPELINE_STAGES.AGE_IDENTIFICATION,
      metadata: { ageGroup: resolved.ageGroup },
    });
    this.emitter.emitStageCompleted({
      ...telemetry,
      stageName: PIPELINE_STAGES.LEARNING_OBJECTIVE_SELECTION,
      metadata: { learningObjective: resolved.learningObjective },
    });

    this.emitter.emitStageStarted({
      ...telemetry,
      stageName: PIPELINE_STAGES.TEMPLATE_SELECTION,
    });
    let selected;
    try {
      selected = await this.templateSelectionService.select({
        topic: resolved.topic,
        ageMin: resolved.ageMin,
        ageMax: resolved.ageMax,
        learningObjective: resolved.learningObjective,
        query: resolved.query,
      });
    } catch (error) {
      this.emitter.emitStageFailed({
        ...telemetry,
        stageName: PIPELINE_STAGES.TEMPLATE_SELECTION,
        errorMessage: getErrorMessage(error),
      });
      throw error;
    }
    this.emitter.emitStageCompleted({
      ...telemetry,
      stageName: PIPELINE_STAGES.TEMPLATE_SELECTION,
      metadata: {
        templateId: selected.template.id,
        ruleId: selected.selection.ruleId,
      },
    });

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
      },
      telemetry,
    );

    this.emitter.emitStageStarted({
      ...telemetry,
      stageName: PIPELINE_STAGES.IMAGE_SEARCH,
    });
    this.emitter.emitStageStarted({
      ...telemetry,
      stageName: PIPELINE_STAGES.IMAGE_MAPPING,
    });

    const usedAssetIds = new Set<string>();
    const cards = await this.imageRetrievalService.mapWithConcurrency(
      llmPayload.cards,
      async (card): Promise<FlashcardCardPayload> => {
        const assetReference =
          await this.imageRetrievalService.retrieveForCard(
            {
              queries: card.imageSearchQueries,
              ageMin: selected.ageMin,
              ageMax: selected.ageMax,
              usedAssetIds,
            },
            telemetry,
          );

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

    this.emitter.emitStageCompleted({
      ...telemetry,
      stageName: PIPELINE_STAGES.IMAGE_SEARCH,
      metadata: { cardCount: cards.length },
    });
    this.emitter.emitStageCompleted({
      ...telemetry,
      stageName: PIPELINE_STAGES.IMAGE_MAPPING,
    });

    this.emitter.emitStageStarted({
      ...telemetry,
      stageName: PIPELINE_STAGES.RESPONSE_ASSEMBLY,
    });

    const response: GenerateFlashcardsResponse = {
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

    this.emitter.emitStageCompleted({
      ...telemetry,
      stageName: PIPELINE_STAGES.RESPONSE_ASSEMBLY,
    });

    this.emitter.emitStageStarted({
      ...telemetry,
      stageName: PIPELINE_STAGES.RESPONSE_VALIDATION,
    });
    if (!Array.isArray(response.cards) || response.cards.length !== count) {
      this.emitter.emitStageFailed({
        ...telemetry,
        stageName: PIPELINE_STAGES.RESPONSE_VALIDATION,
        errorMessage: 'assembled card count mismatch',
      });
      throw new FlashcardException(
        'INVALID_LLM_OUTPUT',
        'Assembled flashcard response failed validation',
      );
    }
    this.emitter.emitStageCompleted({
      ...telemetry,
      stageName: PIPELINE_STAGES.RESPONSE_VALIDATION,
    });

    return response;
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

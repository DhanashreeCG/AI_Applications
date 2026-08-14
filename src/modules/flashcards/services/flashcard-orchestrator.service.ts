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
  FlashcardRenderedOutput,
  GenerateFlashcardsResponse,
  TemplateComponentDefinition,
} from '../interfaces/flashcard.interfaces';
import { parseEditableComponentsFromLayout } from '../utils/template-layout.util';
import { expandDefinitionsForAvailableIds } from '../utils/repeat-component.util';
import { assertAssembledCardComponents } from '../utils/assembled-card.validator';
import { resolveUserRequest } from '../utils/user-request.resolver';
import {
  FlashcardPipelineEmitter,
  createTelemetryContext,
} from '../telemetry/flashcard-pipeline.events';
import { FlashcardContentService } from './flashcard-content.service';
import { FlashcardImageRetrievalService } from './flashcard-image-retrieval.service';
import { FlashcardRendererService } from '../flashcard-renderer/renderer/flashcard-renderer.service';
import { FlashcardRenderResult } from '../flashcard-renderer/interfaces/render-result.interface';
import { TemplateSelectionService } from './template-selection.service';
import type { SelectTemplateResult } from './template-selection.service';

export interface GenerateFlashcardsOptions {
  correlationId?: string;
}

@Injectable()
export class FlashcardOrchestratorService {
  private readonly logger = new Logger(FlashcardOrchestratorService.name);
  private readonly emitter: FlashcardPipelineEmitter;
  private readonly workflowType: string;
  private readonly renderingEnabled: boolean;

  constructor(
    private readonly templateSelectionService: TemplateSelectionService,
    private readonly contentService: FlashcardContentService,
    private readonly imageRetrievalService: FlashcardImageRetrievalService,
    private readonly rendererService: FlashcardRendererService,
    private readonly configService: ConfigService,
    eventEmitter: EventEmitter2,
  ) {
    this.emitter = new FlashcardPipelineEmitter(eventEmitter);
    this.workflowType =
      this.configService.get<string>('pipelineTracking.workflowDefault') ||
      'flashcards';
    this.renderingEnabled =
      this.configService.get<boolean>('flashcards.renderer.enabled') !== false;
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
        templateId: dto.templateId?.trim() || undefined,
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
          rendered: Boolean(response.renderedOutput),
          storageBackend: response.renderedOutput?.storageBackend,
        },
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

  private async runGenerate(
    dto: GenerateFlashcardsDto,
    telemetry: PipelineTelemetryContext,
  ): Promise<GenerateFlashcardsResponse> {
    this.emitter.emitStageStarted({
      ...telemetry,
      stageName: PIPELINE_STAGES.REQUEST_VALIDATION,
    });
    const count = dto.count ?? DEFAULT_FLASHCARD_COUNT;
    const explicitTemplateId = dto.templateId?.trim() || null;
    if (dto.templateId !== undefined && dto.templateId !== null && !explicitTemplateId) {
      this.emitter.emitStageFailed({
        ...telemetry,
        stageName: PIPELINE_STAGES.REQUEST_VALIDATION,
        errorMessage: 'templateId must be a non-empty string when provided',
      });
      throw new FlashcardException(
        'INVALID_REQUEST',
        'templateId must be a non-empty string when provided',
        HttpStatus.BAD_REQUEST,
      );
    }
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
        learningObjective: resolved.learningObjective,
        objectiveConfidence: resolved.objectiveConfidence,
        explicitTemplateId,
      },
    });

    const selected = explicitTemplateId
      ? await this.loadExplicitTemplate(
          explicitTemplateId,
          resolved,
          telemetry,
        )
      : await this.runObjectiveAndTemplateSelection(resolved, telemetry);

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
        selectedTemplate: selected.template,
        textComponents,
        imageComponents,
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
        // Expand any `{x}` image placeholders into the concrete ids the LLM
        // returned (image-1..image-N) before retrieval + merge.
        const expandedImageDefinitions = expandDefinitionsForAvailableIds(
          imageComponents,
          Object.keys(card.imageComponents),
        );
        const retrievedImages =
          await this.imageRetrievalService.mapWithConcurrency(
          expandedImageDefinitions,
          async (imageDefinition) => {
            const query =
              card.imageComponents[imageDefinition.componentId];
            const assetReference =
              await this.imageRetrievalService.retrieveForCard(
              {
                queries: query ? [query] : [],
                topic: resolved.topic,
                ageMin: selected.ageMin,
                ageMax: selected.ageMax,
                usedAssetIds,
              },
              telemetry,
            );
            return [
              imageDefinition.componentId,
              assetReference,
            ] as const;
          },
        );
        const imageRefs = Object.fromEntries(retrievedImages);

        // Expand `{x}` text/image placeholders using the concrete keys present
        // on this card so FINAL_VALIDATION sees num-1..num-N, not "num-{x}".
        const expandedEditableComponents = expandDefinitionsForAvailableIds(
          editableComponents,
          [
            ...Object.keys(card.textComponents),
            ...Object.keys(card.imageComponents),
          ],
        );

        const components: EditableComponentPayload[] =
          expandedEditableComponents.map((definition) =>
            this.mergeComponent(
              definition,
              card.textComponents,
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
      requestId: telemetry.requestId,
      executionId: telemetry.executionId,
      correlationId: telemetry.correlationId,
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
    try {
      this.assertFinalResponse(response, count, editableComponents);
    } catch (error) {
      this.emitter.emitStageFailed({
        ...telemetry,
        stageName: PIPELINE_STAGES.FINAL_VALIDATION,
        errorMessage: getErrorMessage(error),
        metadata: {
          templateId: response.template.id,
          templateVersion: response.templateVersion,
        },
      });
      throw error;
    }
    this.emitter.emitStageCompleted({
      ...telemetry,
      stageName: PIPELINE_STAGES.FINAL_VALIDATION,
      metadata: {
        templateId: response.template.id,
        templateVersion: response.templateVersion,
        cardCount: response.cards.length,
        componentCountPerCard: editableComponents.length,
      },
    });

    const renderedOutput = await this.runRenderingStage(response, telemetry);

    this.emitter.emitStageStarted({
      ...telemetry,
      stageName: PIPELINE_STAGES.RESPONSE_RETURN,
    });
    this.emitter.emitStageCompleted({
      ...telemetry,
      stageName: PIPELINE_STAGES.RESPONSE_RETURN,
      metadata: {
        templateId: response.template.id,
        cardCount: response.cards.length,
        rendered: Boolean(renderedOutput),
      },
    });

    return renderedOutput ? { ...response, renderedOutput } : response;
  }

  private async runRenderingStage(
    response: GenerateFlashcardsResponse,
    telemetry: PipelineTelemetryContext,
  ): Promise<FlashcardRenderedOutput | undefined> {
    if (!this.renderingEnabled) {
      this.emitter.emitStageSkipped({
        ...telemetry,
        stageName: PIPELINE_STAGES.FLASHCARD_RENDERING,
        metadata: { reason: 'renderer_disabled' },
      });
      return undefined;
    }

    this.emitter.emitStageStarted({
      ...telemetry,
      stageName: PIPELINE_STAGES.FLASHCARD_RENDERING,
      metadata: {
        cardCount: response.cards.length,
        templateId: response.template.id,
      },
    });

    try {
      const renderResult = await this.rendererService.render(response);
      const renderedOutput = this.toRenderedOutput(renderResult);

      this.emitter.emitStageCompleted({
        ...telemetry,
        stageName: PIPELINE_STAGES.FLASHCARD_RENDERING,
        metadata: {
          storageBackend: renderedOutput.storageBackend,
          outputLocation: renderedOutput.outputLocation,
          cardCount: renderedOutput.cards.length,
          warningCount: renderedOutput.warnings.length,
          totalMs: renderedOutput.timing.totalMs,
          htmlMs: renderedOutput.timing.htmlMs,
          browserMs: renderedOutput.timing.browserMs,
          pdfMs: renderedOutput.timing.pdfMs,
          pdfPath: renderedOutput.pdf.path,
        },
      });

      return renderedOutput;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.warn(`Flashcard rendering failed: ${errorMessage}`);
      this.emitter.emitStageFailed({
        ...telemetry,
        stageName: PIPELINE_STAGES.FLASHCARD_RENDERING,
        errorMessage,
        metadata: {
          cardCount: response.cards.length,
          templateId: response.template.id,
        },
      });
      return undefined;
    }
  }

  private toRenderedOutput(
    renderResult: FlashcardRenderResult,
  ): FlashcardRenderedOutput {
    return {
      storageBackend: renderResult.storageBackend,
      requestId: renderResult.requestId,
      outputLocation: renderResult.outputLocation,
      cards: renderResult.cards.map((card) => ({
        cardIndex: card.cardIndex,
        cardId: card.cardId,
        fileName: card.fileName,
        path: card.path,
        uri: card.uri,
      })),
      preview: {
        path: renderResult.preview.path,
        uri: renderResult.preview.uri,
      },
      pdf: {
        path: renderResult.pdf.path,
        uri: renderResult.pdf.uri,
      },
      timing: renderResult.timing,
      warnings: renderResult.warnings,
    };
  }

  private async runObjectiveAndTemplateSelection(
    resolved: ReturnType<typeof resolveUserRequest>,
    telemetry: PipelineTelemetryContext,
  ): Promise<SelectTemplateResult> {
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
        objectiveConfidence: resolved.objectiveConfidence,
      },
    });

    return this.selectTemplateWithRetry(resolved, telemetry);
  }

  private async loadExplicitTemplate(
    templateId: string,
    resolved: ReturnType<typeof resolveUserRequest>,
    telemetry: PipelineTelemetryContext,
  ): Promise<SelectTemplateResult> {
    this.emitter.emitStageSkipped({
      ...telemetry,
      stageName: PIPELINE_STAGES.EDUCATIONAL_OBJECTIVE_DETERMINATION,
      metadata: {
        reason: 'explicit_templateId',
        templateId,
        learningObjective: resolved.learningObjective,
      },
    });
    this.emitter.emitStageSkipped({
      ...telemetry,
      stageName: PIPELINE_STAGES.TEMPLATE_SELECTION,
      metadata: {
        reason: 'explicit_templateId',
        templateId,
      },
    });

    try {
      return await this.templateSelectionService.selectByTemplateId({
        templateId,
        learningObjective: resolved.learningObjective,
        ageMin: resolved.ageMin,
        ageMax: resolved.ageMax,
        ageGroup: resolved.ageGroup,
      });
    } catch (error) {
      if (
        error instanceof FlashcardException &&
        (error.code === 'NO_TEMPLATE_FOUND' ||
          error.code === 'TEMPLATE_VERSION_MISMATCH')
      ) {
        this.emitter.emitStageFailed({
          ...telemetry,
          stageName: PIPELINE_STAGES.TEMPLATE_SELECTION,
          errorMessage: getErrorMessage(error),
          metadata: { templateId, bypassed: true },
        });
      }
      throw error;
    }
  }

  private async selectTemplateWithRetry(
    resolved: ReturnType<typeof resolveUserRequest>,
    telemetry: PipelineTelemetryContext,
  ): Promise<SelectTemplateResult> {
    this.emitter.emitStageStarted({
      ...telemetry,
      stageName: PIPELINE_STAGES.TEMPLATE_SELECTION,
    });

    const selectOnce = () =>
      this.templateSelectionService.select({
        topic: resolved.topic,
        ageMin: resolved.ageMin,
        ageMax: resolved.ageMax,
        ageGroup: resolved.ageGroup,
        learningObjective: resolved.learningObjective,
        objectiveConfidence: resolved.objectiveConfidence,
        grade: resolved.grade,
        subject: resolved.subject,
        difficulty: resolved.difficulty,
        query: resolved.query,
        telemetry,
      });

    const buildSelectionMetadata = (
      selected: SelectTemplateResult,
      extra?: Record<string, unknown>,
    ) => ({
      templateId: selected.template.id,
      ruleId: selected.selection.ruleId,
      templateVersion: selected.template.templateVersion,
      requestedAgeGroup: resolved.ageGroup,
      templateAgeGroups: selected.template.supportedAgeGroups,
      learningObjective: resolved.learningObjective,
      objectiveConfidence: resolved.objectiveConfidence,
      selectionScore: selected.selection.score,
      selectionMode: selected.aiSelection?.selectionMode ?? 'deterministic',
      aiConfidence: selected.aiSelection?.result?.confidenceScore,
      aiReasoning: selected.aiSelection?.result?.reasoning,
      aiFallbackReason: selected.aiSelection?.fallbackReason,
      catalogHash: selected.aiSelection?.catalogHash,
      cachedTokens: selected.aiSelection?.result?.cachedInputTokens,
      rankingBreakdown: selected.ranking?.map((candidate) => ({
        templateId: candidate.templateId,
        ruleId: candidate.ruleId,
        score: candidate.score,
        breakdown: candidate.breakdown,
      })),
      ...extra,
    });

    try {
      const selected = await selectOnce();
      this.emitter.emitStageCompleted({
        ...telemetry,
        stageName: PIPELINE_STAGES.TEMPLATE_SELECTION,
        metadata: buildSelectionMetadata(selected),
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
            metadata: buildSelectionMetadata(selected, {
              retriedAfterInactive: true,
            }),
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
        `Assembled flashcard response failed validation: expected ${count} cards, received ${Array.isArray(response.cards) ? response.cards.length : 'non-array'}`,
      );
    }

    const seenCardIds = new Set<string>();

    for (const card of response.cards) {
      if (!card.cardId || seenCardIds.has(card.cardId)) {
        throw new FlashcardException(
          'INVALID_LLM_OUTPUT',
          `Assembled response has a missing or duplicate cardId "${card.cardId}"`,
        );
      }
      seenCardIds.add(card.cardId);

      assertAssembledCardComponents(
        card.cardId,
        card.components,
        editableComponents,
      );
    }
  }

  private mergeComponent(
    definition: TemplateComponentDefinition,
    contentById: Record<string, string>,
    imageRefs: Record<
      string,
      NonNullable<EditableComponentPayload['assetReference']>
    >,
  ): EditableComponentPayload {
    if (definition.componentType === 'image') {
      const assetReference = imageRefs[definition.componentId] ?? null;
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

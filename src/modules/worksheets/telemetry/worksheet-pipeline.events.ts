import { getErrorMessage } from '../../../common/utils/error-message';
import {
  PIPELINE_STAGES,
  PipelineTelemetryContext,
} from '../../../common/events/pipeline-tracker.events';
import { FlashcardPipelineEmitter } from '../../flashcards/telemetry/flashcard-pipeline.events';

export {
  FlashcardPipelineEmitter as WorksheetPipelineEmitter,
  createTelemetryContext,
  hashPayload,
} from '../../flashcards/telemetry/flashcard-pipeline.events';

export const WORKSHEET_GENERATE_STAGES = [
  PIPELINE_STAGES.REQUEST_VALIDATION,
  PIPELINE_STAGES.REQUEST_ANALYSIS,
  PIPELINE_STAGES.TEMPLATE_SELECTION,
  PIPELINE_STAGES.LLM_CONTENT_GENERATION,
  PIPELINE_STAGES.PROMPT_GENERATION,
  PIPELINE_STAGES.LLM_REQUEST,
  PIPELINE_STAGES.CONTENT_VALIDATION,
  PIPELINE_STAGES.IMAGE_QUERY_GENERATION,
  PIPELINE_STAGES.IMAGE_RETRIEVAL,
  PIPELINE_STAGES.IMAGE_MAPPING,
  PIPELINE_STAGES.STRUCTURE_VALIDATION,
  PIPELINE_STAGES.PERSISTENCE,
  PIPELINE_STAGES.RESPONSE_ASSEMBLY,
  PIPELINE_STAGES.FINAL_VALIDATION,
  PIPELINE_STAGES.RESPONSE_RETURN,
] as const;

export async function runTrackedStage<T>(
  emitter: FlashcardPipelineEmitter,
  telemetry: PipelineTelemetryContext,
  stageName: string,
  fn: () => Promise<T> | T,
  options?: {
    startMetadata?: Record<string, unknown>;
    completeMetadata?:
      | Record<string, unknown>
      | ((result: T) => Record<string, unknown>);
  },
): Promise<T> {
  emitter.emitStageStarted({
    ...telemetry,
    stageName,
    metadata: options?.startMetadata,
  });
  try {
    const result = await fn();
    const complete =
      typeof options?.completeMetadata === 'function'
        ? options.completeMetadata(result)
        : options?.completeMetadata;
    emitter.emitStageCompleted({
      ...telemetry,
      stageName,
      metadata: complete,
    });
    return result;
  } catch (error) {
    emitter.emitStageFailed({
      ...telemetry,
      stageName,
      errorMessage: getErrorMessage(error),
    });
    throw error;
  }
}

export async function maybeRunTrackedStage<T>(
  emitter: FlashcardPipelineEmitter,
  telemetry: PipelineTelemetryContext | undefined,
  stageName: string,
  fn: () => Promise<T> | T,
  options?: {
    startMetadata?: Record<string, unknown>;
    completeMetadata?:
      | Record<string, unknown>
      | ((result: T) => Record<string, unknown>);
  },
): Promise<T> {
  if (!telemetry) {
    return fn();
  }
  return runTrackedStage(emitter, telemetry, stageName, fn, options);
}

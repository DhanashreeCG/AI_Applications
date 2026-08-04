/**
 * Shared pipeline-tracker event contract.
 * Flashcards emit these; the tracker module listens.
 * Safe to leave emit sites when the tracker module is removed.
 */

export const PIPELINE_TRACKER_EVENTS = {
  PIPELINE_STARTED: 'pipeline.started',
  PIPELINE_COMPLETED: 'pipeline.completed',
  PIPELINE_FAILED: 'pipeline.failed',
  STAGE_STARTED: 'pipeline.stage.started',
  STAGE_COMPLETED: 'pipeline.stage.completed',
  STAGE_FAILED: 'pipeline.stage.failed',
  STAGE_SKIPPED: 'pipeline.stage.skipped',
  AI_INVOCATION_STARTED: 'pipeline.ai.started',
  AI_INVOCATION_COMPLETED: 'pipeline.ai.completed',
  IMAGE_SEARCH_STARTED: 'pipeline.image_search.started',
  IMAGE_SEARCH_COMPLETED: 'pipeline.image_search.completed',
  EVENT_RECORDED: 'pipeline.event.recorded',
} as const;

export type PipelineTrackerEventName =
  (typeof PIPELINE_TRACKER_EVENTS)[keyof typeof PIPELINE_TRACKER_EVENTS];

export const PIPELINE_STAGES = {
  REQUEST_VALIDATION: 'request_validation',
  AGE_IDENTIFICATION: 'age_identification',
  LEARNING_OBJECTIVE_SELECTION: 'learning_objective_selection',
  TEMPLATE_SELECTION: 'template_selection',
  PROMPT_GENERATION: 'prompt_generation',
  LLM_REQUEST: 'llm_request',
  LLM_RESPONSE_VALIDATION: 'llm_response_validation',
  IMAGE_SEARCH: 'image_search',
  IMAGE_MAPPING: 'image_mapping',
  RESPONSE_ASSEMBLY: 'response_assembly',
  RESPONSE_VALIDATION: 'response_validation',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type PipelineStageName =
  (typeof PIPELINE_STAGES)[keyof typeof PIPELINE_STAGES];

export interface PipelineTelemetryContext {
  executionId: string;
  requestId: string;
  correlationId: string;
  workflowType: string;
}

export interface PipelineStartedPayload extends PipelineTelemetryContext {
  metadata?: Record<string, unknown>;
}

export interface PipelineTerminalPayload extends PipelineTelemetryContext {
  status: 'completed' | 'failed';
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface StageLifecyclePayload extends PipelineTelemetryContext {
  stageName: string;
  metadata?: Record<string, unknown>;
  errorMessage?: string;
  retryCount?: number;
}

export interface AiInvocationStartedPayload extends PipelineTelemetryContext {
  invocationId: string;
  stageName?: string;
  provider: string;
  model: string;
  purpose: string;
  promptHash?: string;
  promptPayload?: unknown;
  retryCount?: number;
}

export interface AiInvocationCompletedPayload extends PipelineTelemetryContext {
  invocationId: string;
  stageName?: string;
  status: 'success' | 'failed';
  responseHash?: string;
  responsePayload?: unknown;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
  /** Wall-clock duration around the provider call; preferred over DB timestamp skew. */
  durationMs?: number;
  errorMessage?: string;
}

export interface ImageSearchStartedPayload extends PipelineTelemetryContext {
  searchId: string;
  stageName?: string;
  query: string;
  filters?: Record<string, unknown>;
}

export interface ImageSearchCompletedPayload extends PipelineTelemetryContext {
  searchId: string;
  stageName?: string;
  query: string;
  filters?: Record<string, unknown>;
  resultCount: number;
  selectedAssetId?: string | null;
  cacheHit?: boolean;
  failed?: boolean;
  errorMessage?: string;
  durationMs?: number;
}

export interface PipelineGenericEventPayload extends PipelineTelemetryContext {
  name: string;
  metadata?: Record<string, unknown>;
}

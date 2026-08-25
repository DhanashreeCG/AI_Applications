import { PipelineTelemetryContext } from '../../../common/events/pipeline-tracker.events';

export type WorksheetTemplateSelectionAiFallbackReason =
  | 'disabled'
  | 'no_candidates'
  | 'single_candidate'
  | 'missing_api_key'
  | 'circuit_open'
  | 'malformed_json'
  | 'invalid_id'
  | 'low_confidence'
  | 'timeout'
  | 'provider_error';

export interface WorksheetTemplateSelectionAiSelectInput {
  topic: string | null;
  query?: string | null;
  ageGroup?: string | null;
  grade?: string | null;
  subject?: string | null;
  difficulty?: string | null;
  allowedTemplateIds: string[];
  telemetry?: PipelineTelemetryContext;
}

export interface WorksheetTemplateSelectionAiResult {
  selectedTemplateId: string;
  confidenceScore: number;
  reasoning: string;
  alternativeTemplateId: string | null;
  catalogHash: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
  latencyMs: number;
}

export interface WorksheetTemplateSelectionAiOutcome {
  result: WorksheetTemplateSelectionAiResult | null;
  usedFallback: boolean;
  fallbackReason?: WorksheetTemplateSelectionAiFallbackReason;
  catalogHash?: string;
}

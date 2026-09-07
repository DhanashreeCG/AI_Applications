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

/** Stage 2 classification output (independent of template catalog). */
export interface WorksheetTemplateIntentClassification {
  theme: string | null;
  subTopic: string | null;
  activityIntent: string | null;
  difficulty: 'easy' | 'medium' | 'hard' | null;
  confidence: number;
}

export interface WorksheetTemplateClassifyInput {
  query?: string | null;
  topic?: string | null;
  difficulty?: string | null;
  ageBand: { min: number; max: number } | null;
  /** Closed theme/subTopic enums when age is FS0–FS2; null → free-form. */
  useClosedTaxonomy: boolean;
  themes: string[];
  subTopics: string[];
  activityTypes: string[];
  telemetry?: PipelineTelemetryContext;
}

export interface WorksheetTemplateSelectionAiSelectInput {
  topic: string | null;
  query?: string | null;
  ageGroup?: string | null;
  grade?: string | null;
  subject?: string | null;
  difficulty?: string | null;
  allowedTemplateIds: string[];
  /** Pre-computed Stage 2 hints for the Stage 3 picker. */
  classification?: WorksheetTemplateIntentClassification | null;
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

/** Attached on selected template for generation telemetry (`_selectionTelemetry`). */
export interface WorksheetTemplateSelectionTelemetry {
  ageBand: { min: number; max: number; source: string } | null;
  ageFilteredCount: number;
  stage2Classification: WorksheetTemplateIntentClassification | null;
  rerankTopScores: Array<{ id: string; slug: string; score: number }>;
  scoreMargin: number | null;
  selectionMode: 'explicit' | 'ai' | 'deterministic';
  selectionReason?: string;
}

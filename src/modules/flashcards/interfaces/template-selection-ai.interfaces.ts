import { PipelineTelemetryContext } from '../../../common/events/pipeline-tracker.events';
import { ObjectiveConfidence } from '../utils/user-request.resolver';

export interface CatalogTemplateEntry {
  id: string;
  name: string;
  description: string;
  templateType: string;
  layoutType: string;
  tags: string[];
  learningObjectives: string[];
  subjectsSupported: string[];
  difficultyLevels: string[];
  supportedAgeGroups: string[];
  componentSummary: string;
  /** Opt-in layout: only valid when the request explicitly asks for it. */
  requiresExplicitRequest: boolean;
}

export interface TemplateCatalogSnapshot {
  catalogBlock: string;
  catalogHash: string;
  entries: CatalogTemplateEntry[];
  builtAt: number;
}

export interface TemplateSelectionAiResult {
  selectedTemplateId: string;
  confidenceScore: number;
  reasoning: string;
  alternativeTemplateId: string | null;
  catalogHash: string;
  cachedInputTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
  latencyMs?: number;
}

export type TemplateSelectionAiFallbackReason =
  | 'disabled'
  | 'single_candidate'
  | 'no_candidates'
  | 'missing_api_key'
  | 'circuit_open'
  | 'timeout'
  | 'invalid_id'
  | 'low_confidence'
  | 'provider_error'
  | 'malformed_json';

export interface TemplateSelectionAiOutcome {
  result: TemplateSelectionAiResult | null;
  usedFallback: boolean;
  fallbackReason?: TemplateSelectionAiFallbackReason;
  /** Present whenever a catalog snapshot was loaded (success or late failure). */
  catalogHash?: string;
}

export interface TemplateSelectionAiSelectInput {
  topic: string;
  ageGroup: string;
  grade?: string | null;
  subject?: string | null;
  difficulty?: string | null;
  learningObjective: string;
  objectiveConfidence?: ObjectiveConfidence;
  allowedTemplateIds: string[];
  /** Exact native age-group matches; prefer these over younger allowed IDs. */
  nativeTemplateIds?: string[];
  query?: string;
  telemetry?: PipelineTelemetryContext;
}

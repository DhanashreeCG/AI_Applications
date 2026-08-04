/**
 * Pipeline Execution Tracker — removable observability plugin.
 *
 * Removal checklist:
 * 1. Remove PipelineTrackerModule from app.module.ts
 * 2. Remove PIPELINE_TRACKING_* env keys / configuration.pipelineTracking
 * 3. Drop Prisma models + migrate
 * 4. Optionally delete src/modules/pipeline-tracker/
 * 5. Flashcard emit sites may remain (no listeners) — workflow still works
 */

export const PIPELINE_TRACKER_STAGE_CATALOG = [
  'request_validation',
  'age_identification',
  'learning_objective_selection',
  'template_selection',
  'prompt_generation',
  'llm_request',
  'llm_response_validation',
  'image_search',
  'image_mapping',
  'response_assembly',
  'response_validation',
  'completed',
  'failed',
] as const;

export const OTEL_ADAPTER = Symbol('PIPELINE_TRACKER_OTEL_ADAPTER');
export const SENTRY_ADAPTER = Symbol('PIPELINE_TRACKER_SENTRY_ADAPTER');

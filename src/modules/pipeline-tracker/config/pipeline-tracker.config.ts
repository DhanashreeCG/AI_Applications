export interface PipelineTrackerConfig {
  enabled: boolean;
  storeAiPayload: boolean;
  workflowDefault: string;
}

export function resolvePipelineTrackerConfig(raw: {
  enabled?: boolean;
  storeAiPayload?: boolean;
  workflowDefault?: string;
}): PipelineTrackerConfig {
  return {
    enabled: raw.enabled !== false,
    storeAiPayload: raw.storeAiPayload === true,
    workflowDefault: raw.workflowDefault || 'flashcards',
  };
}

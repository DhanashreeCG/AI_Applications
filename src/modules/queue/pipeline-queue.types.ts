export interface SendMessageOptions {
  delaySeconds?: number;
  jobId?: string;
}

export const PIPELINE_QUEUE = Symbol('PIPELINE_QUEUE');

import { AssetState } from '../../common/enums/asset-state.enum';
import {
  AiMetadataMessage,
  DlqMessage,
  EmbeddingMessage,
  IngestionProcessMessage,
  S3UploadMessage,
} from '../../common/interfaces/sqs-messages.interface';

export const QUEUE_NAMES = {
  ingestion: 'ingestion',
  s3Upload: 's3Upload',
  aiMetadata: 'aiMetadata',
  embedding: 'embedding',
  dlq: 'dlq',
} as const;

export type QueueName = keyof typeof QUEUE_NAMES;

export type QueueMessageMap = {
  ingestion: IngestionProcessMessage;
  s3Upload: S3UploadMessage;
  aiMetadata: AiMetadataMessage;
  embedding: EmbeddingMessage;
  dlq: DlqMessage;
};

/** Maps pipeline asset states to their dedicated SQS processing queue. */
export const STAGE_QUEUE_MAP: Partial<Record<AssetState, QueueName>> = {
  [AssetState.DISCOVERED]: 'ingestion',
  [AssetState.DOWNLOADING]: 'ingestion',
  [AssetState.UPLOADING_TO_S3]: 's3Upload',
  [AssetState.GENERATING_METADATA]: 'aiMetadata',
  [AssetState.GENERATING_EMBEDDING]: 'embedding',
};

export const PROCESSING_QUEUES: QueueName[] = [
  'ingestion',
  's3Upload',
  'aiMetadata',
  'embedding',
];

export function getQueueForStage(stage: AssetState): QueueName | undefined {
  return STAGE_QUEUE_MAP[stage];
}

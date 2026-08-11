import { AssetState } from '../enums/asset-state.enum';

export interface BasePipelineMessage {
  jobId: string;
  ingestionFileId: string;
  assetId?: string;
  traceId?: string;
  attempt: number;
  timestamp: string;
}

/** @deprecated Use BasePipelineMessage — kept for gradual rename compatibility */
export type BaseSqsMessage = BasePipelineMessage;

export interface IngestionProcessMessage extends BasePipelineMessage {
  stage: AssetState.DISCOVERED | AssetState.DOWNLOADING;
  driveFileId: string;
}

export interface S3UploadMessage extends BasePipelineMessage {
  assetId: string;
  contentHash: string;
}

export interface AiMetadataMessage extends BasePipelineMessage {
  assetId: string;
  s3ObjectKey: string;
  contentHash: string;
}

export interface EmbeddingMessage extends BasePipelineMessage {
  assetId: string;
  searchDescription: string;
  metadataVersion: number;
}

export interface DlqMessage extends BasePipelineMessage {
  failedStage: AssetState;
  errorCode: string;
  errorMessage: string;
  stackTrace?: string;
}

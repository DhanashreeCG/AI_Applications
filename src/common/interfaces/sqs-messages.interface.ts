import { AssetState } from '../enums/asset-state.enum';

export interface BaseSqsMessage {
  jobId: string;
  ingestionFileId: string;
  assetId?: string;
  traceId?: string;
  attempt: number;
  timestamp: string;
}

export interface IngestionProcessMessage extends BaseSqsMessage {
  stage: AssetState.DISCOVERED | AssetState.DOWNLOADING;
  driveFileId: string;
}

export interface S3UploadMessage extends BaseSqsMessage {
  assetId: string;
  contentHash: string;
}

export interface AiMetadataMessage extends BaseSqsMessage {
  assetId: string;
  s3ObjectKey: string;
  contentHash: string;
}

export interface EmbeddingMessage extends BaseSqsMessage {
  assetId: string;
  searchDescription: string;
  metadataVersion: number;
}

export interface DlqMessage extends BaseSqsMessage {
  failedStage: AssetState;
  errorCode: string;
  errorMessage: string;
  stackTrace?: string;
}

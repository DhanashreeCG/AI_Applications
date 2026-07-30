import { BaseSqsMessage } from '../../../common/interfaces/sqs-messages.interface';
import { AssetState } from '../../../common/enums/asset-state.enum';
import { StructuredLogFields } from '../interfaces/structured-log.interface';

export function buildPipelineLogFields(
  message: BaseSqsMessage,
  stage: AssetState,
  extras?: StructuredLogFields,
): StructuredLogFields {
  return {
    job_id: message.jobId,
    ingestion_file_id: message.ingestionFileId,
    asset_id: message.assetId,
    processing_stage: stage,
    attempt: message.attempt,
    trace_id: message.traceId,
    ...extras,
  };
}

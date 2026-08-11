import { buildPipelineLogFields } from './pipeline-log-fields.util';
import { AssetState } from '../../../common/enums/asset-state.enum';

describe('buildPipelineLogFields', () => {
  it('should map pipeline message fields to structured log keys', () => {
    const fields = buildPipelineLogFields(
      {
        jobId: 'job-001',
        ingestionFileId: 'file-001',
        assetId: 'asset-001',
        traceId: 'trace-001',
        attempt: 2,
        timestamp: '2026-07-30T00:00:00.000Z',
      },
      AssetState.GENERATING_METADATA,
      { sqs_message_id: 'sqs-001' },
    );

    expect(fields).toEqual({
      job_id: 'job-001',
      ingestion_file_id: 'file-001',
      asset_id: 'asset-001',
      processing_stage: AssetState.GENERATING_METADATA,
      attempt: 2,
      trace_id: 'trace-001',
      sqs_message_id: 'sqs-001',
    });
  });
});

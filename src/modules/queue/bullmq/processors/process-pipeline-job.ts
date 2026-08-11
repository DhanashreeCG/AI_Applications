import { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { AssetPipelineService } from '../../../pipeline/services/asset-pipeline.service';
import { StructuredLoggerService } from '../../../observability/structured-logger.service';
import { QueueName } from '../../queue-topology.constants';
import { isValidPipelineMessage } from '../../utils/sqs-message-validator.util';
import { BasePipelineMessage } from '../../../../common/interfaces/pipeline-messages.interface';

export function resolveWorkerOptions(configService: ConfigService) {
  const enabled = configService.get<boolean>('queueWorker.enabled') ?? true;
  return {
    concurrency: configService.get<number>('queueWorker.concurrency') ?? 4,
    lockDuration:
      configService.get<number>('queueWorker.lockDurationMs') ?? 900000,
    autorun: enabled,
  };
}

export async function processPipelineJob(
  queueName: QueueName,
  job: Job<BasePipelineMessage>,
  assetPipeline: AssetPipelineService,
  logger: StructuredLoggerService,
): Promise<void> {
  const startedAt = Date.now();
  const body = job.data;

  if (!isValidPipelineMessage(body)) {
    logger.error('Discarding malformed BullMQ job', {
      queue: queueName,
      job_id: job.id,
      status: 'malformed',
    });
    return;
  }

  logger.log('BullMQ job processing started', {
    job_id: body.jobId,
    ingestion_file_id: body.ingestionFileId,
    asset_id: body.assetId,
    bullmq_job_id: job.id,
    queue: queueName,
    attempt: body.attempt,
    status: 'processing',
  });

  try {
    await assetPipeline.processQueueMessage(
      queueName,
      body,
      job.id != null ? String(job.id) : undefined,
    );

    logger.log('BullMQ job processed successfully', {
      job_id: body.jobId,
      ingestion_file_id: body.ingestionFileId,
      asset_id: body.assetId,
      bullmq_job_id: job.id,
      queue: queueName,
      duration_ms: Date.now() - startedAt,
      status: 'success',
    });
  } catch (error) {
    // PipelineRetryService already scheduled retry/DLQ; swallow so BullMQ
    // does not apply a second retry layer (jobs use attempts: 1).
    logger.error(
      'BullMQ job processing failed; retry/DLQ handled by pipeline',
      {
        job_id: body.jobId,
        ingestion_file_id: body.ingestionFileId,
        asset_id: body.assetId,
        bullmq_job_id: job.id,
        queue: queueName,
        duration_ms: Date.now() - startedAt,
        status: 'failed',
      },
      error,
    );
  }
}

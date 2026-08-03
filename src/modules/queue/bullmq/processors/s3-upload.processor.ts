import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AssetPipelineService } from '../../../pipeline/services/asset-pipeline.service';
import { StructuredLoggerService } from '../../../observability/structured-logger.service';
import { QUEUE_NAMES } from '../../queue-topology.constants';
import { S3UploadMessage } from '../../../../common/interfaces/pipeline-messages.interface';
import { processPipelineJob } from './process-pipeline-job';
import { bullmqProcessorOptions } from './processor.constants';

@Processor(QUEUE_NAMES.s3Upload, bullmqProcessorOptions())
export class S3UploadProcessor extends WorkerHost {
  private readonly logger = new StructuredLoggerService(S3UploadProcessor.name);

  constructor(private readonly assetPipeline: AssetPipelineService) {
    super();
  }

  async process(job: Job<S3UploadMessage>): Promise<void> {
    await processPipelineJob(
      's3Upload',
      job,
      this.assetPipeline,
      this.logger,
    );
  }
}

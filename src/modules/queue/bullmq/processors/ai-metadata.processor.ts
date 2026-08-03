import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AssetPipelineService } from '../../../pipeline/services/asset-pipeline.service';
import { StructuredLoggerService } from '../../../observability/structured-logger.service';
import { QUEUE_NAMES } from '../../queue-topology.constants';
import { AiMetadataMessage } from '../../../../common/interfaces/pipeline-messages.interface';
import { processPipelineJob } from './process-pipeline-job';
import { bullmqProcessorOptions } from './processor.constants';

@Processor(QUEUE_NAMES.aiMetadata, bullmqProcessorOptions())
export class AiMetadataProcessor extends WorkerHost {
  private readonly logger = new StructuredLoggerService(
    AiMetadataProcessor.name,
  );

  constructor(private readonly assetPipeline: AssetPipelineService) {
    super();
  }

  async process(job: Job<AiMetadataMessage>): Promise<void> {
    await processPipelineJob(
      'aiMetadata',
      job,
      this.assetPipeline,
      this.logger,
    );
  }
}

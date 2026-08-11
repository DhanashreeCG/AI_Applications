import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AssetPipelineService } from '../../../pipeline/services/asset-pipeline.service';
import { StructuredLoggerService } from '../../../observability/structured-logger.service';
import { QUEUE_NAMES } from '../../queue-topology.constants';
import { IngestionProcessMessage } from '../../../../common/interfaces/pipeline-messages.interface';
import { processPipelineJob } from './process-pipeline-job';
import { bullmqProcessorOptions } from './processor.constants';

@Processor(QUEUE_NAMES.ingestion, bullmqProcessorOptions())
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new StructuredLoggerService(IngestionProcessor.name);

  constructor(private readonly assetPipeline: AssetPipelineService) {
    super();
  }

  async process(job: Job<IngestionProcessMessage>): Promise<void> {
    await processPipelineJob(
      'ingestion',
      job,
      this.assetPipeline,
      this.logger,
    );
  }
}

import { SqsQueueService } from '../../src/modules/queue/sqs-queue.service';
import { SqsWorkerService } from '../../src/modules/queue/sqs-worker.service';
import { parseArg, runValidation } from './shared/bootstrap';

void runValidation(async (app) => {
  const queue = (parseArg('queue') ?? 'ingestion') as
    | 'ingestion'
    | 's3Upload'
    | 'aiMetadata'
    | 'embedding'
    | 'dlq';
  const sqs = app.get(SqsQueueService);
  const worker = app.get(SqsWorkerService);

  const depth = await sqs.getQueueDepth(queue);
  const configuredQueues = sqs.getConfiguredQueues();
  const processingQueues = sqs.getProcessingQueues();

  return {
    queue,
    depth,
    configuredQueues,
    processingQueues,
    workerEnabled: worker.isRunning(),
    activeWorkers: worker.getActiveWorkerCount(),
  };
});

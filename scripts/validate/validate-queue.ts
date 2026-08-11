import { BullmqQueueService } from '../../src/modules/queue/bullmq/bullmq-queue.service';
import { QUEUE_NAMES, QueueName } from '../../src/modules/queue/queue-topology.constants';
import { runValidation, parseArg } from './shared/bootstrap';

async function main(): Promise<void> {
  await runValidation(async (app) => {
    const queue = app.get(BullmqQueueService);
    const requested = parseArg('queue') as QueueName | undefined;
    const queues = requested
      ? [requested]
      : queue.getProcessingQueues();

    const depths: Record<string, number> = {};
    for (const name of queues) {
      if (!(name in QUEUE_NAMES)) {
        throw new Error(`Unknown queue: ${name}`);
      }
      depths[name] = await queue.getQueueDepth(name);
    }

    return {
      backend: 'bullmq',
      configuredQueues: queue.getConfiguredQueues(),
      processingQueues: queue.getProcessingQueues(),
      depths,
      workersEnabled:
        (process.env.QUEUE_WORKER_ENABLED ?? process.env.SQS_WORKER_ENABLED) !==
        'false',
    };
  });
}

void main();

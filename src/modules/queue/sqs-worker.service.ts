import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssetPipelineService } from '../pipeline/services/asset-pipeline.service';
import { StructuredLoggerService } from '../observability/structured-logger.service';
import { QueueName } from './queue-topology.constants';
import { ReceivedMessage, SqsQueueService } from './sqs-queue.service';
import { isValidPipelineMessage } from './utils/sqs-message-validator.util';

@Injectable()
export class SqsWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new StructuredLoggerService(SqsWorkerService.name);
  private readonly enabled: boolean;
  private readonly pollWaitSeconds: number;
  private readonly concurrency: number;
  private readonly shutdownTimeoutMs: number;
  private readonly visibilityTimeoutSeconds: number;
  private running = false;
  private activeWorkers = 0;
  private readonly waitQueue: Array<() => void> = [];
  private readonly inFlight = new Set<Promise<void>>();
  private pollTasks: Promise<void>[] = [];

  constructor(
    private readonly sqsQueue: SqsQueueService,
    private readonly assetPipeline: AssetPipelineService,
    configService: ConfigService,
  ) {
    this.enabled = configService.get<boolean>('sqsWorker.enabled') ?? true;
    this.pollWaitSeconds =
      configService.get<number>('sqsWorker.pollWaitSeconds') ?? 20;
    this.concurrency = configService.get<number>('sqsWorker.concurrency') ?? 4;
    this.shutdownTimeoutMs =
      configService.get<number>('sqsWorker.shutdownTimeoutMs') ?? 30000;
    this.visibilityTimeoutSeconds =
      configService.get<number>('sqsWorker.visibilityTimeoutSeconds') ?? 900;
  }

  public async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.warn('SQS workers are disabled by configuration');
      return;
    }

    const queues = this.sqsQueue.getProcessingQueues();
    if (queues.length === 0) {
      this.logger.warn('No processing queues configured; SQS workers not started');
      return;
    }

    this.running = true;
    this.pollTasks = queues.map((queueName) => this.pollQueue(queueName));
    this.logger.log('SQS workers started', {
      queues,
      concurrency: this.concurrency,
      poll_wait_seconds: this.pollWaitSeconds,
    });
  }

  public async onModuleDestroy(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;
    this.logger.log('SQS worker shutdown initiated');

    await Promise.race([
      Promise.allSettled([...this.inFlight]),
      new Promise<void>((resolve) =>
        setTimeout(resolve, this.shutdownTimeoutMs),
      ),
    ]);

    await Promise.allSettled(this.pollTasks);
    this.logger.log('SQS worker shutdown complete');
  }

  public isRunning(): boolean {
    return this.running;
  }

  public getActiveWorkerCount(): number {
    return this.activeWorkers;
  }

  private async pollQueue(queueName: QueueName): Promise<void> {
    while (this.running) {
      try {
        const messages = await this.sqsQueue.receiveMessages(
          queueName,
          1,
          this.pollWaitSeconds,
        );

        for (const message of messages) {
          if (!this.running) {
            break;
          }

          await this.acquireSlot();
          const task = this.processMessage(queueName, message).finally(() =>
            this.releaseSlot(),
          );
          this.inFlight.add(task);
          task.finally(() => this.inFlight.delete(task));
        }
      } catch (error) {
        this.logger.error(
          'SQS poll loop error',
          { queue: queueName, status: 'poll_failed' },
          error,
        );
        await this.sleep(1000);
      }
    }
  }

  private async processMessage(
    queueName: QueueName,
    message: ReceivedMessage<unknown>,
  ): Promise<void> {
    const startedAt = Date.now();

    if (!isValidPipelineMessage(message.body)) {
      this.logger.error('Deleting malformed SQS message', {
        queue: queueName,
        sqs_message_id: message.messageId,
        status: 'malformed',
      });
      await this.sqsQueue.deleteMessage(queueName, message.receiptHandle);
      return;
    }

    const body = message.body;

    this.logger.log('SQS message processing started', {
      job_id: body.jobId,
      ingestion_file_id: body.ingestionFileId,
      asset_id: body.assetId,
      sqs_message_id: message.messageId,
      queue: queueName,
      attempt: body.attempt,
      status: 'processing',
    });

    try {
      if (this.visibilityTimeoutSeconds > 0) {
        await this.sqsQueue.changeMessageVisibility(
          queueName,
          message.receiptHandle,
          this.visibilityTimeoutSeconds,
        );
      }

      await this.assetPipeline.processQueueMessage(
        queueName,
        body,
        message.messageId,
      );

      await this.sqsQueue.deleteMessage(queueName, message.receiptHandle);

      this.logger.log('SQS message processed successfully', {
        job_id: body.jobId,
        ingestion_file_id: body.ingestionFileId,
        asset_id: body.assetId,
        sqs_message_id: message.messageId,
        queue: queueName,
        duration_ms: Date.now() - startedAt,
        status: 'success',
      });
    } catch (error) {
      await this.sqsQueue.deleteMessage(queueName, message.receiptHandle);

      this.logger.error(
        'SQS message processing failed; original message deleted after failure handling',
        {
          job_id: body.jobId,
          ingestion_file_id: body.ingestionFileId,
          asset_id: body.assetId,
          sqs_message_id: message.messageId,
          queue: queueName,
          duration_ms: Date.now() - startedAt,
          status: 'failed',
        },
        error,
      );
    }
  }

  private async acquireSlot(): Promise<void> {
    if (this.activeWorkers < this.concurrency) {
      this.activeWorkers++;
      return;
    }

    await new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
    this.activeWorkers++;
  }

  private releaseSlot(): void {
    this.activeWorkers--;
    const next = this.waitQueue.shift();
    if (next) {
      next();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

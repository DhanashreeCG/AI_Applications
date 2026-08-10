import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  AiMetadataMessage,
  DlqMessage,
  EmbeddingMessage,
  IngestionProcessMessage,
  S3UploadMessage,
} from '../../../common/interfaces/pipeline-messages.interface';
import {
  PROCESSING_QUEUES,
  QUEUE_NAMES,
  QueueMessageMap,
  QueueName,
} from '../queue-topology.constants';
import { SendMessageOptions } from '../pipeline-queue.types';

@Injectable()
export class BullmqQueueService {
  private readonly logger = new Logger(BullmqQueueService.name);
  private readonly queues: Record<QueueName, Queue>;

  constructor(
    @InjectQueue(QUEUE_NAMES.ingestion)
    ingestionQueue: Queue,
    @InjectQueue(QUEUE_NAMES.s3Upload)
    s3UploadQueue: Queue,
    @InjectQueue(QUEUE_NAMES.aiMetadata)
    aiMetadataQueue: Queue,
    @InjectQueue(QUEUE_NAMES.embedding)
    embeddingQueue: Queue,
    @InjectQueue(QUEUE_NAMES.dlq)
    dlqQueue: Queue,
  ) {
    this.queues = {
      ingestion: ingestionQueue,
      s3Upload: s3UploadQueue,
      aiMetadata: aiMetadataQueue,
      embedding: embeddingQueue,
      dlq: dlqQueue,
    };
  }

  public getConfiguredQueues(): QueueName[] {
    return Object.keys(this.queues) as QueueName[];
  }

  public getProcessingQueues(): QueueName[] {
    return [...PROCESSING_QUEUES];
  }

  public async dispatchIngestion(
    message: Omit<IngestionProcessMessage, 'timestamp'> & {
      timestamp?: string;
    },
    options?: SendMessageOptions,
  ): Promise<string> {
    return this.sendStageMessage('ingestion', message, options);
  }

  public async dispatchS3Upload(
    message: Omit<S3UploadMessage, 'timestamp'> & { timestamp?: string },
    options?: SendMessageOptions,
  ): Promise<string> {
    return this.sendStageMessage('s3Upload', message, options);
  }

  public async dispatchAiMetadata(
    message: Omit<AiMetadataMessage, 'timestamp'> & { timestamp?: string },
    options?: SendMessageOptions,
  ): Promise<string> {
    return this.sendStageMessage('aiMetadata', message, options);
  }

  public async dispatchEmbedding(
    message: Omit<EmbeddingMessage, 'timestamp'> & { timestamp?: string },
    options?: SendMessageOptions,
  ): Promise<string> {
    return this.sendStageMessage('embedding', message, options);
  }

  public async dispatchToDlq(
    message: Omit<DlqMessage, 'timestamp'> & { timestamp?: string },
    options?: SendMessageOptions,
  ): Promise<string> {
    return this.sendStageMessage('dlq', message, options);
  }

  public async sendMessage<Q extends QueueName>(
    queueName: Q,
    payload: QueueMessageMap[Q],
    options?: SendMessageOptions,
  ): Promise<string> {
    const queue = this.queues[queueName];
    const job = await queue.add(queueName, payload, {
      // App-managed retries via PipelineRetryService — do not double-retry in BullMQ
      attempts: 1,
      removeOnComplete: 1000,
      removeOnFail: 5000,
      delay:
        options?.delaySeconds && options.delaySeconds > 0
          ? options.delaySeconds * 1000
          : undefined,
      jobId: options?.jobId,
    });

    const messageId = String(job.id);
    this.logger.log(
      `BullMQ job enqueued on ${queueName}. JobId: ${messageId}`,
    );
    return messageId;
  }

  public async getQueueDepth(queueName: QueueName): Promise<number> {
    const queue = this.queues[queueName];
    const counts = await queue.getJobCounts(
      'waiting',
      'delayed',
      'active',
      'paused',
    );
    return (
      (counts.waiting ?? 0) +
      (counts.delayed ?? 0) +
      (counts.active ?? 0) +
      (counts.paused ?? 0)
    );
  }

  private async sendStageMessage<Q extends QueueName>(
    queueName: Q,
    message: Omit<QueueMessageMap[Q], 'timestamp'> & { timestamp?: string },
    options?: SendMessageOptions,
  ): Promise<string> {
    const payload = {
      ...message,
      timestamp: message.timestamp ?? new Date().toISOString(),
    } as QueueMessageMap[Q];

    return this.sendMessage(queueName, payload, options);
  }
}

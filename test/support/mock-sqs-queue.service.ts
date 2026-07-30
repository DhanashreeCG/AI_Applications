import { QueueName } from '../../src/modules/queue/queue-topology.constants';

interface QueuedMessage<T = unknown> {
  messageId: string;
  body: T;
}

export class MockSqsQueueService {
  private readonly queues: Record<QueueName, QueuedMessage[]> = {
    ingestion: [],
    s3Upload: [],
    aiMetadata: [],
    embedding: [],
    dlq: [],
  };

  private messageCounter = 0;

  public getConfiguredQueues(): QueueName[] {
    return Object.keys(this.queues) as QueueName[];
  }

  public getProcessingQueues(): QueueName[] {
    return ['ingestion', 's3Upload', 'aiMetadata', 'embedding'];
  }

  public async sendMessage<T>(
    queueName: QueueName,
    message: T,
    _options?: { delaySeconds?: number },
  ): Promise<string> {
    const messageId = `mock-sqs-${++this.messageCounter}`;
    this.queues[queueName].push({
      messageId,
      body: message,
    });
    return messageId;
  }

  public async dispatchIngestion(message: Record<string, unknown>) {
    return this.sendMessage('ingestion', this.withTimestamp(message));
  }

  public async dispatchS3Upload(message: Record<string, unknown>) {
    return this.sendMessage('s3Upload', this.withTimestamp(message));
  }

  public async dispatchAiMetadata(message: Record<string, unknown>) {
    return this.sendMessage('aiMetadata', this.withTimestamp(message));
  }

  public async dispatchEmbedding(message: Record<string, unknown>) {
    return this.sendMessage('embedding', this.withTimestamp(message));
  }

  public async dispatchToDlq(message: Record<string, unknown>) {
    return this.sendMessage('dlq', this.withTimestamp(message));
  }

  public peekQueue(queueName: QueueName): QueuedMessage[] {
    return [...this.queues[queueName]];
  }

  public dequeue(queueName: QueueName): QueuedMessage | undefined {
    return this.queues[queueName].shift();
  }

  public reset(): void {
    for (const queueName of Object.keys(this.queues) as QueueName[]) {
      this.queues[queueName] = [];
    }
    this.messageCounter = 0;
  }

  private withTimestamp<T extends Record<string, unknown>>(message: T) {
    return {
      ...message,
      timestamp:
        (message.timestamp as string | undefined) ??
        new Date().toISOString(),
    };
  }
}

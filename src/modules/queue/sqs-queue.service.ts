import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ChangeMessageVisibilityCommand,
  SQSClientConfig,
} from '@aws-sdk/client-sqs';
import {
  AiMetadataMessage,
  DlqMessage,
  EmbeddingMessage,
  IngestionProcessMessage,
  S3UploadMessage,
} from '../../common/interfaces/sqs-messages.interface';
import {
  PROCESSING_QUEUES,
  QueueMessageMap,
  QueueName,
} from './queue-topology.constants';

export interface ReceivedMessage<T> {
  messageId: string;
  receiptHandle: string;
  body: T;
  attributes: Record<string, string>;
}

@Injectable()
export class SqsQueueService {
  private readonly logger = new Logger(SqsQueueService.name);
  private readonly sqsClient: SQSClient;
  private readonly queueUrls: Record<QueueName, string>;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('aws.region') || 'us-east-1';
    const accessKeyId = this.configService.get<string>('aws.accessKeyId');
    const secretAccessKey = this.configService.get<string>(
      'aws.secretAccessKey',
    );

    const clientConfig: SQSClientConfig = {
      region,
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
    };

    this.sqsClient = new SQSClient(clientConfig);

    this.queueUrls = {
      ingestion:
        this.configService.get<string>('aws.sqsIngestionQueueUrl') || '',
      s3Upload: this.configService.get<string>('aws.sqsS3UploadQueueUrl') || '',
      aiMetadata:
        this.configService.get<string>('aws.sqsAiMetadataQueueUrl') || '',
      embedding:
        this.configService.get<string>('aws.sqsEmbeddingQueueUrl') || '',
      dlq: this.configService.get<string>('aws.sqsDlqUrl') || '',
    };
  }

  public getConfiguredQueues(): QueueName[] {
    return (Object.keys(this.queueUrls) as QueueName[]).filter(
      (name) => this.queueUrls[name].length > 0,
    );
  }

  public getProcessingQueues(): QueueName[] {
    return PROCESSING_QUEUES.filter((name) => this.queueUrls[name].length > 0);
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
    const queueUrl = this.requireQueueUrl(queueName);

    const command = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(payload),
      DelaySeconds: options?.delaySeconds,
      MessageGroupId: options?.groupId,
      MessageDeduplicationId: options?.deduplicationId,
    });

    const response = await this.sqsClient.send(command);
    const messageId = response.MessageId || 'unknown';
    this.logger.log(
      `SQS message sent to ${queueName} queue. MessageId: ${messageId}`,
    );
    return messageId;
  }

  public async receiveMessages<Q extends QueueName>(
    queueName: Q,
    maxMessages = 10,
    waitTimeSeconds = 20,
  ): Promise<ReceivedMessage<QueueMessageMap[Q]>[]> {
    const queueUrl = this.requireQueueUrl(queueName);

    const command = new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: maxMessages,
      WaitTimeSeconds: waitTimeSeconds,
      AttributeNames: ['All'],
      MessageAttributeNames: ['All'],
    });

    const response = await this.sqsClient.send(command);
    const messages = response.Messages || [];

    return messages.map((msg) => ({
      messageId: msg.MessageId || '',
      receiptHandle: msg.ReceiptHandle || '',
      body: JSON.parse(msg.Body || '{}') as QueueMessageMap[Q],
      attributes: msg.Attributes || {},
    }));
  }

  public async deleteMessage(
    queueName: QueueName,
    receiptHandle: string,
  ): Promise<void> {
    const queueUrl = this.requireQueueUrl(queueName);

    await this.sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );

    this.logger.debug(`Deleted message from ${queueName} queue`);
  }

  public async changeMessageVisibility(
    queueName: QueueName,
    receiptHandle: string,
    visibilityTimeoutSeconds: number,
  ): Promise<void> {
    const queueUrl = this.requireQueueUrl(queueName);

    await this.sqsClient.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: visibilityTimeoutSeconds,
      }),
    );
  }

  public async getQueueDepth(queueName: QueueName): Promise<number> {
    const queueUrl = this.queueUrls[queueName];
    if (!queueUrl) return 0;

    const response = await this.sqsClient.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }),
    );

    return parseInt(
      response.Attributes?.['ApproximateNumberOfMessages'] || '0',
      10,
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

  private requireQueueUrl(queueName: QueueName): string {
    const queueUrl = this.queueUrls[queueName];
    if (!queueUrl) {
      throw new Error(`Queue URL for "${queueName}" is not configured`);
    }
    return queueUrl;
  }
}

export interface SendMessageOptions {
  groupId?: string;
  deduplicationId?: string;
  delaySeconds?: number;
}

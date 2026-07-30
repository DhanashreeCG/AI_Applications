import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  SQSClientConfig,
} from '@aws-sdk/client-sqs';

@Injectable()
export class SqsQueueService {
  private readonly logger = new Logger(SqsQueueService.name);
  private readonly sqsClient: SQSClient;

  private readonly queueUrls: Record<string, string>;

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

  public async sendMessage<T extends object>(
    queueName: keyof typeof this.queueUrls,
    payload: T,
    options?: {
      groupId?: string;
      deduplicationId?: string;
      delaySeconds?: number;
    },
  ): Promise<string> {
    const queueUrl = this.queueUrls[queueName];
    if (!queueUrl) {
      throw new Error(`Queue URL for "${queueName}" is not configured`);
    }

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

  public async receiveMessages<T>(
    queueName: keyof typeof this.queueUrls,
    maxMessages = 10,
    waitTimeSeconds = 20,
  ): Promise<Array<{ messageId: string; receiptHandle: string; body: T }>> {
    const queueUrl = this.queueUrls[queueName];
    if (!queueUrl) {
      throw new Error(`Queue URL for "${queueName}" is not configured`);
    }

    const command = new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: maxMessages,
      WaitTimeSeconds: waitTimeSeconds,
      AttributeNames: ['All'],
    });

    const response = await this.sqsClient.send(command);
    const messages = response.Messages || [];

    return messages.map((msg) => ({
      messageId: msg.MessageId || '',
      receiptHandle: msg.ReceiptHandle || '',
      body: JSON.parse(msg.Body || '{}') as T,
    }));
  }

  public async deleteMessage(
    queueName: keyof typeof this.queueUrls,
    receiptHandle: string,
  ): Promise<void> {
    const queueUrl = this.queueUrls[queueName];
    await this.sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  public async getQueueDepth(
    queueName: keyof typeof this.queueUrls,
  ): Promise<number> {
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
}

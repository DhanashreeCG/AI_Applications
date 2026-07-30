import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import {
  StorageProvider,
  StorageUploadOptions,
  StorageUploadResult,
} from '../../common/interfaces/storage-provider.interface';

@Injectable()
export class S3StorageService implements StorageProvider {
  private readonly logger = new Logger(S3StorageService.name);
  private readonly s3Client: S3Client;
  private readonly defaultBucket: string;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('aws.region') || 'us-east-1';
    const accessKeyId = this.configService.get<string>('aws.accessKeyId');
    const secretAccessKey = this.configService.get<string>('aws.secretAccessKey');
    this.defaultBucket =
      this.configService.get<string>('aws.s3BucketName') || 'ai-asset-ingestion';

    const clientConfig: any = { region };
    if (accessKeyId && secretAccessKey) {
      clientConfig.credentials = { accessKeyId, secretAccessKey };
    }

    this.s3Client = new S3Client(clientConfig);
  }

  public getDefaultBucket(): string {
    return this.defaultBucket;
  }

  public generateCanonicalKey(assetId: string, filename: string): string {
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    return `assets/${assetId}/original/${sanitizedFilename}`;
  }

  public async uploadFile(
    buffer: Buffer,
    options: StorageUploadOptions,
  ): Promise<StorageUploadResult> {
    const bucket = options.bucket || this.defaultBucket;
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: options.key,
      Body: buffer,
      ContentType: options.contentType,
      Metadata: options.metadata,
    });

    const response = await this.s3Client.send(command);
    this.logger.log(`Uploaded file to S3: s3://${bucket}/${options.key}`);

    return {
      bucket,
      key: options.key,
      eTag: response.ETag,
      location: `s3://${bucket}/${options.key}`,
    };
  }

  public async uploadStream(
    stream: Readable,
    options: StorageUploadOptions,
  ): Promise<StorageUploadResult> {
    const bucket = options.bucket || this.defaultBucket;
    const parallelUpload = new Upload({
      client: this.s3Client,
      params: {
        Bucket: bucket,
        Key: options.key,
        Body: stream,
        ContentType: options.contentType,
        Metadata: options.metadata,
      },
    });

    const response = await parallelUpload.done();
    this.logger.log(`Stream uploaded to S3: s3://${bucket}/${options.key}`);

    return {
      bucket,
      key: options.key,
      eTag: response.ETag,
      location: `s3://${bucket}/${options.key}`,
    };
  }

  public async fileExists(key: string, bucket?: string): Promise<boolean> {
    const targetBucket = bucket || this.defaultBucket;
    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: targetBucket,
          Key: key,
        }),
      );
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  public async getSignedUrl(
    key: string,
    expiresInSeconds = 3600,
    bucket?: string,
  ): Promise<string> {
    const targetBucket = bucket || this.defaultBucket;
    const command = new GetObjectCommand({
      Bucket: targetBucket,
      Key: key,
    });
    return getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
  }

  public async downloadBuffer(key: string, bucket?: string): Promise<Buffer> {
    const targetBucket = bucket || this.defaultBucket;
    const command = new GetObjectCommand({
      Bucket: targetBucket,
      Key: key,
    });

    const response = await this.s3Client.send(command);
    if (!response.Body) {
      throw new Error(`S3 object Body is empty for key: ${key}`);
    }

    const byteArray = await response.Body.transformToByteArray();
    return Buffer.from(byteArray);
  }

  public async deleteFile(key: string, bucket?: string): Promise<void> {
    const targetBucket = bucket || this.defaultBucket;
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: targetBucket,
        Key: key,
      }),
    );
    this.logger.log(`Deleted S3 object: s3://${targetBucket}/${key}`);
  }
}

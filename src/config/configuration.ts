export interface AppConfig {
  nodeEnv: string;
  port: number;
  database: {
    url: string;
  };
  aws: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    s3BucketName: string;
    sqsIngestionQueueUrl: string;
    sqsS3UploadQueueUrl: string;
    sqsAiMetadataQueueUrl: string;
    sqsEmbeddingQueueUrl: string;
    sqsDlqUrl: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  googleDrive: {
    clientEmail?: string;
    privateKey?: string;
    apiKey?: string;
  };
  ai: {
    geminiApiKey?: string;
    openaiApiKey?: string;
  };
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  database: {
    url: process.env.DATABASE_URL || '',
  },
  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    s3BucketName: process.env.AWS_S3_BUCKET_NAME || 'ai-asset-ingestion',
    sqsIngestionQueueUrl: process.env.AWS_SQS_INGESTION_QUEUE_URL || '',
    sqsS3UploadQueueUrl: process.env.AWS_SQS_S3_UPLOAD_QUEUE_URL || '',
    sqsAiMetadataQueueUrl: process.env.AWS_SQS_AI_METADATA_QUEUE_URL || '',
    sqsEmbeddingQueueUrl: process.env.AWS_SQS_EMBEDDING_QUEUE_URL || '',
    sqsDlqUrl: process.env.AWS_SQS_DLQ_URL || '',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },
  googleDrive: {
    clientEmail: process.env.GOOGLE_DRIVE_CLIENT_EMAIL,
    privateKey: process.env.GOOGLE_DRIVE_PRIVATE_KEY,
    apiKey: process.env.GOOGLE_DRIVE_API_KEY,
  },
  ai: {
    geminiApiKey: process.env.GEMINI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  },
});

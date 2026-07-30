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
    enabled: boolean;
    searchCacheTtlSeconds: number;
    assetMetadataCacheTtlSeconds: number;
  };
  googleDrive: {
    clientEmail?: string;
    privateKey?: string;
    apiKey?: string;
  };
  ai: {
    geminiApiKey?: string;
    geminiModel: string;
    geminiPromptVersion: string;
    openaiApiKey?: string;
    openaiEmbeddingModel: string;
  };
  pipeline: {
    maxAttempts: number;
    backoffBaseSeconds: number;
    backoffMaxSeconds: number;
  };
  sqsWorker: {
    enabled: boolean;
    pollWaitSeconds: number;
    concurrency: number;
    shutdownTimeoutMs: number;
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
    enabled: process.env.REDIS_ENABLED !== 'false',
    searchCacheTtlSeconds: parseInt(
      process.env.REDIS_SEARCH_CACHE_TTL_SECONDS || '300',
      10,
    ),
    assetMetadataCacheTtlSeconds: parseInt(
      process.env.REDIS_ASSET_METADATA_CACHE_TTL_SECONDS || '3600',
      10,
    ),
  },
  googleDrive: {
    clientEmail: process.env.GOOGLE_DRIVE_CLIENT_EMAIL,
    privateKey: process.env.GOOGLE_DRIVE_PRIVATE_KEY,
    apiKey: process.env.GOOGLE_DRIVE_API_KEY,
  },
  ai: {
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    geminiPromptVersion: process.env.GEMINI_PROMPT_VERSION || 'v1',
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiEmbeddingModel:
      process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
  },
  pipeline: {
    maxAttempts: parseInt(process.env.PIPELINE_MAX_ATTEMPTS || '3', 10),
    backoffBaseSeconds: parseInt(
      process.env.PIPELINE_BACKOFF_BASE_SECONDS || '30',
      10,
    ),
    backoffMaxSeconds: parseInt(
      process.env.PIPELINE_BACKOFF_MAX_SECONDS || '900',
      10,
    ),
  },
  sqsWorker: {
    enabled: process.env.SQS_WORKER_ENABLED !== 'false',
    pollWaitSeconds: parseInt(process.env.SQS_WORKER_POLL_WAIT_SECONDS || '20', 10),
    concurrency: parseInt(process.env.SQS_WORKER_CONCURRENCY || '4', 10),
    shutdownTimeoutMs: parseInt(
      process.env.SQS_WORKER_SHUTDOWN_TIMEOUT_MS || '30000',
      10,
    ),
  },
});

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
    credentialsPath?: string;
    apiKey?: string;
  };
  ai: {
    geminiApiKey?: string;
    geminiModel: string;
    geminiPromptVersion: string;
    flashcardPromptVersion: string;
    openaiApiKey?: string;
    openaiEmbeddingModel: string;
    costGeminiPerImageUsd: number;
    costOpenAiEmbeddingPerCallUsd: number;
    geminiMaxRps: number;
    openaiMaxRps: number;
    circuitFailureThreshold: number;
    circuitCooldownMs: number;
  };
  pipeline: {
    maxAttempts: number;
    backoffBaseSeconds: number;
    backoffMaxSeconds: number;
  };
  queueWorker: {
    enabled: boolean;
    concurrency: number;
    lockDurationMs: number;
    shutdownTimeoutMs: number;
    prefix: string;
  };
  flashcards: {
    imageConcurrency: number;
    signedUrlTtlSeconds: number;
    imageSearchLimit: number;
    renderer: {
      storageRoot: string;
      concurrency: number;
      apiBaseUrl: string;
    };
  };
  pipelineTracking: {
    enabled: boolean;
    storeAiPayload: boolean;
    workflowDefault: string;
  };
}

function envFlagEnabled(primary: string, fallback: string): boolean {
  if (process.env[primary] !== undefined) {
    return process.env[primary] !== 'false';
  }
  if (process.env[fallback] !== undefined) {
    return process.env[fallback] !== 'false';
  }
  return true;
}

function envInt(primary: string, fallback: string, defaultValue: number): number {
  const raw = process.env[primary] ?? process.env[fallback];
  return parseInt(raw || String(defaultValue), 10);
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
    credentialsPath: process.env.GOOGLE_DRIVE_CREDENTIALS_PATH,
    apiKey: process.env.GOOGLE_DRIVE_API_KEY,
  },
  ai: {
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    geminiPromptVersion: process.env.GEMINI_PROMPT_VERSION || 'v1',
    flashcardPromptVersion: process.env.FLASHCARD_PROMPT_VERSION || 'v1',
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiEmbeddingModel:
      process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    costGeminiPerImageUsd: parseFloat(
      process.env.AI_COST_GEMINI_PER_IMAGE || '0.001',
    ),
    costOpenAiEmbeddingPerCallUsd: parseFloat(
      process.env.AI_COST_OPENAI_EMBEDDING_PER_CALL || '0.00002',
    ),
    geminiMaxRps: parseFloat(process.env.GEMINI_MAX_RPS || '2'),
    openaiMaxRps: parseFloat(process.env.OPENAI_MAX_RPS || '10'),
    circuitFailureThreshold: parseInt(
      process.env.AI_CIRCUIT_FAILURE_THRESHOLD || '5',
      10,
    ),
    circuitCooldownMs: parseInt(
      process.env.AI_CIRCUIT_COOLDOWN_MS || '60000',
      10,
    ),
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
  queueWorker: {
    enabled: envFlagEnabled('QUEUE_WORKER_ENABLED', 'SQS_WORKER_ENABLED'),
    concurrency: envInt('QUEUE_WORKER_CONCURRENCY', 'SQS_WORKER_CONCURRENCY', 4),
    lockDurationMs: (() => {
      if (process.env.QUEUE_WORKER_LOCK_DURATION_MS) {
        return parseInt(process.env.QUEUE_WORKER_LOCK_DURATION_MS, 10);
      }
      if (process.env.SQS_VISIBILITY_TIMEOUT_SECONDS) {
        return parseInt(process.env.SQS_VISIBILITY_TIMEOUT_SECONDS, 10) * 1000;
      }
      return 900000;
    })(),
    shutdownTimeoutMs: envInt(
      'QUEUE_WORKER_SHUTDOWN_TIMEOUT_MS',
      'SQS_WORKER_SHUTDOWN_TIMEOUT_MS',
      30000,
    ),
    prefix: process.env.BULLMQ_PREFIX || 'asset-ingestion',
  },
  flashcards: {
    imageConcurrency: parseInt(
      process.env.FLASHCARD_IMAGE_CONCURRENCY || '3',
      10,
    ),
    signedUrlTtlSeconds: parseInt(
      process.env.FLASHCARD_SIGNED_URL_TTL_SECONDS || '3600',
      10,
    ),
    imageSearchLimit: parseInt(
      process.env.FLASHCARD_IMAGE_SEARCH_LIMIT || '1',
      10,
    ),
    renderer: {
      storageRoot:
        process.env.FLASHCARD_RENDERER_STORAGE_ROOT || 'storage/flashcards',
      concurrency: parseInt(
        process.env.FLASHCARD_RENDERER_CONCURRENCY || '4',
        10,
      ),
      apiBaseUrl:
        process.env.FLASHCARD_RENDERER_API_BASE_URL || 'http://localhost:3000',
    },
  },
  pipelineTracking: {
    enabled: process.env.PIPELINE_TRACKING_ENABLED !== 'false',
    storeAiPayload: process.env.PIPELINE_STORE_AI_PAYLOAD === 'true',
    workflowDefault:
      process.env.PIPELINE_TRACKING_WORKFLOW_DEFAULT || 'flashcards',
  },
});

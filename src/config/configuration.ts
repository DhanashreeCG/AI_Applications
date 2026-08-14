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
    flashcardContentProvider: string;
    geminiFlashcardModel: string;
    openaiFlashcardModel: string;
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
    templateSelectionAi: {
      enabled: boolean;
      provider: string;
      openaiModel: string;
      geminiModel: string;
      minConfidence: number;
      timeoutMs: number;
      catalogTtlMs: number;
      costPerMInputUsd: number;
      costPerMCachedInputUsd: number;
      costPerMOutputUsd: number;
    };
    renderer: {
      enabled: boolean;
      storageBackend: 'local' | 's3';
      storageRoot: string;
      s3KeyPrefix: string;
      s3Bucket?: string;
      signedUrlTtlSeconds: number;
      concurrency: number;
      apiBaseUrl: string;
    };
  };
  worksheets: {
    imageConcurrency: number;
    signedUrlTtlSeconds: number;
    imageSearchLimit: number;
    imagePickerLimit: number;
    generateCountDefault: number;
    generateCountMax: number;
    geminiModel: string;
    promptVersion: string;
    renderer: {
      enabled: boolean;
      s3KeyPrefix: string;
      s3Bucket?: string;
      signedUrlTtlSeconds: number;
      apiBaseUrl: string;
      defaultWidth: number;
      defaultHeight: number;
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
    flashcardContentProvider:
      process.env.FLASHCARD_CONTENT_PROVIDER || 'gemini',
    geminiFlashcardModel:
      process.env.FLASHCARD_GEMINI_MODEL || 'gemini-2.5-flash',
    openaiFlashcardModel: process.env.OPENAI_FLASHCARD_MODEL || 'gpt-4o-mini',
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
    templateSelectionAi: {
      enabled: process.env.FLASHCARD_TEMPLATE_SELECTION_AI_ENABLED !== 'false',
      provider:
        process.env.FLASHCARD_TEMPLATE_SELECTION_PROVIDER || 'openai',
      openaiModel:
        process.env.FLASHCARD_TEMPLATE_SELECTION_OPENAI_MODEL ||
        'gpt-4.1-mini',
      geminiModel:
        process.env.FLASHCARD_TEMPLATE_SELECTION_GEMINI_MODEL ||
        'gemini-2.5-flash',
      minConfidence: parseFloat(
        process.env.FLASHCARD_TEMPLATE_SELECTION_MIN_CONFIDENCE || '0.5',
      ),
      timeoutMs: parseInt(
        process.env.FLASHCARD_TEMPLATE_SELECTION_TIMEOUT_MS || '6000',
        10,
      ),
      catalogTtlMs: parseInt(
        process.env.FLASHCARD_TEMPLATE_SELECTION_CATALOG_TTL_MS || '600000',
        10,
      ),
      costPerMInputUsd: parseFloat(
        process.env.FLASHCARD_TEMPLATE_SELECTION_COST_PER_M_INPUT_USD || '0.4',
      ),
      costPerMCachedInputUsd: parseFloat(
        process.env.FLASHCARD_TEMPLATE_SELECTION_COST_PER_M_CACHED_INPUT_USD ||
          '0.1',
      ),
      costPerMOutputUsd: parseFloat(
        process.env.FLASHCARD_TEMPLATE_SELECTION_COST_PER_M_OUTPUT_USD || '1.6',
      ),
    },
    renderer: {
      enabled: process.env.FLASHCARD_RENDERER_ENABLED !== 'false',
      storageBackend:
        (process.env.FLASHCARD_RENDERER_STORAGE_BACKEND || 'local').toLowerCase() ===
        's3'
          ? 's3'
          : 'local',
      storageRoot:
        process.env.FLASHCARD_RENDERER_STORAGE_ROOT || 'storage/flashcards',
      s3KeyPrefix:
        process.env.FLASHCARD_RENDERER_S3_KEY_PREFIX || 'flashcards/rendered',
      s3Bucket: process.env.FLASHCARD_RENDERER_S3_BUCKET || undefined,
      signedUrlTtlSeconds: parseInt(
        process.env.FLASHCARD_RENDERER_SIGNED_URL_TTL_SECONDS || '3600',
        10,
      ),
      concurrency: parseInt(
        process.env.FLASHCARD_RENDERER_CONCURRENCY || '4',
        10,
      ),
      apiBaseUrl:
        process.env.FLASHCARD_RENDERER_API_BASE_URL || 'http://localhost:3000',
    },
  },
  worksheets: {
    imageConcurrency: parseInt(
      process.env.WORKSHEET_IMAGE_CONCURRENCY ||
        process.env.FLASHCARD_IMAGE_CONCURRENCY ||
        '3',
      10,
    ),
    signedUrlTtlSeconds: parseInt(
      process.env.WORKSHEET_SIGNED_URL_TTL_SECONDS ||
        process.env.FLASHCARD_SIGNED_URL_TTL_SECONDS ||
        '3600',
      10,
    ),
    imageSearchLimit: parseInt(
      process.env.WORKSHEET_IMAGE_SEARCH_LIMIT || '1',
      10,
    ),
    imagePickerLimit: parseInt(
      process.env.WORKSHEET_IMAGE_PICKER_LIMIT || '12',
      10,
    ),
    generateCountDefault: parseInt(
      process.env.WORKSHEET_GENERATE_COUNT_DEFAULT || '1',
      10,
    ),
    generateCountMax: parseInt(
      process.env.WORKSHEET_GENERATE_COUNT_MAX || '10',
      10,
    ),
    geminiModel:
      process.env.WORKSHEET_GEMINI_MODEL ||
      process.env.FLASHCARD_GEMINI_MODEL ||
      'gemini-2.5-flash',
    promptVersion: process.env.WORKSHEET_PROMPT_VERSION || 'v1',
    renderer: {
      enabled: process.env.WORKSHEET_RENDERER_ENABLED !== 'false',
      s3KeyPrefix:
        process.env.WORKSHEET_RENDERER_S3_KEY_PREFIX || 'worksheets/rendered',
      s3Bucket: process.env.WORKSHEET_RENDERER_S3_BUCKET || undefined,
      signedUrlTtlSeconds: parseInt(
        process.env.WORKSHEET_RENDERER_SIGNED_URL_TTL_SECONDS || '3600',
        10,
      ),
      apiBaseUrl:
        process.env.WORKSHEET_RENDERER_API_BASE_URL ||
        process.env.FLASHCARD_RENDERER_API_BASE_URL ||
        `http://localhost:${process.env.PORT || '5000'}`,
      defaultWidth: parseInt(process.env.WORKSHEET_RENDER_WIDTH || '1016', 10),
      defaultHeight: parseInt(
        process.env.WORKSHEET_RENDER_HEIGHT || '1316',
        10,
      ),
    },
  },
  pipelineTracking: {
    enabled: process.env.PIPELINE_TRACKING_ENABLED !== 'false',
    storeAiPayload: process.env.PIPELINE_STORE_AI_PAYLOAD === 'true',
    workflowDefault:
      process.env.PIPELINE_TRACKING_WORKFLOW_DEFAULT || 'flashcards',
  },
});

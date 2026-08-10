export interface ClassifiedError {
  retryable: boolean;
  errorCode: string;
  errorMessage: string;
}

const RETRYABLE_PATTERNS = [
  /\b429\b/,
  /\b500\b/,
  /\b502\b/,
  /\b503\b/,
  /\b504\b/,
  /timeout/i,
  /timed out/i,
  /network/i,
  /econnreset/i,
  /econnrefused/i,
  /etimedout/i,
  /temporar/i,
  /rate limit/i,
  /service unavailable/i,
  /vision provider error/i,
  /gemini request failed/i,
  /circuit open/i,
  /slow down/i,
  /throttl/i,
  /prisma.*timed out/i,
  /connection.*(reset|refused|terminated)/i,
];

const NON_RETRYABLE_PATTERNS = [
  /unsupported file format/i,
  /unsupported image format/i,
  /unsupported mime/i,
  /corrupt(ed)? image/i,
  /invalid image/i,
  /permission denied/i,
  /invalid credentials/i,
  /authentication/i,
  /unauthorized/i,
  /\b401\b/,
  /\b403\b/,
  /\b400\b/,
  /deleted drive file/i,
  /not found/i,
  /empty file buffer/i,
  /invalid request/i,
  /malformed/i,
  /embedding input text cannot be empty/i,
];

function extractHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const record = error as Record<string, unknown>;
  const candidates = [
    record.status,
    record.statusCode,
    record.code,
    (record.error as Record<string, unknown> | undefined)?.status,
    (record.response as Record<string, unknown> | undefined)?.status,
    (
      (record.response as Record<string, unknown> | undefined)?.statusCode
    ),
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'number' && candidate >= 100 && candidate < 600) {
      return candidate;
    }
    if (typeof candidate === 'string' && /^\d{3}$/.test(candidate)) {
      return parseInt(candidate, 10);
    }
  }

  return undefined;
}

export function classifyProcessingError(error: unknown): ClassifiedError {
  const errorMessage =
    error instanceof Error ? error.message : String(error ?? 'Unknown error');
  const normalized = errorMessage.toLowerCase();
  const httpStatus = extractHttpStatus(error);

  if (httpStatus !== undefined) {
    if (httpStatus === 401 || httpStatus === 403) {
      return {
        retryable: false,
        errorCode: 'AUTH_ERROR',
        errorMessage,
      };
    }
    if (httpStatus === 400 || httpStatus === 422) {
      return {
        retryable: false,
        errorCode: 'INVALID_REQUEST',
        errorMessage,
      };
    }
    if (httpStatus === 429 || (httpStatus >= 500 && httpStatus <= 599)) {
      return {
        retryable: true,
        errorCode: httpStatus === 429 ? 'RATE_LIMITED' : 'TRANSIENT_ERROR',
        errorMessage,
      };
    }
  }

  for (const pattern of NON_RETRYABLE_PATTERNS) {
    if (pattern.test(normalized)) {
      const errorCode =
        /\b401\b|unauthorized|authentication|invalid credentials/i.test(
          normalized,
        )
          ? 'AUTH_ERROR'
          : /invalid image|corrupt|unsupported/i.test(normalized)
            ? 'VALIDATION_ERROR'
            : 'NON_RETRYABLE_ERROR';
      return {
        retryable: false,
        errorCode,
        errorMessage,
      };
    }
  }

  for (const pattern of RETRYABLE_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        retryable: true,
        errorCode: /circuit open|429|rate limit/i.test(normalized)
          ? 'RATE_LIMITED'
          : 'TRANSIENT_ERROR',
        errorMessage,
      };
    }
  }

  if (error instanceof Error && error.name === 'TimeoutError') {
    return {
      retryable: true,
      errorCode: 'TIMEOUT',
      errorMessage,
    };
  }

  if (error instanceof Error && error.name === 'CircuitOpenError') {
    return {
      retryable: true,
      errorCode: 'RATE_LIMITED',
      errorMessage,
    };
  }

  return {
    retryable: false,
    errorCode: 'UNCLASSIFIED_ERROR',
    errorMessage,
  };
}

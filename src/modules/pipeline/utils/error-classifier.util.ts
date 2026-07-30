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
];

const NON_RETRYABLE_PATTERNS = [
  /unsupported file format/i,
  /unsupported image format/i,
  /corrupt(ed)? image/i,
  /invalid image/i,
  /permission denied/i,
  /invalid credentials/i,
  /deleted drive file/i,
  /not found/i,
  /empty file buffer/i,
  /invalid request/i,
];

export function classifyProcessingError(error: unknown): ClassifiedError {
  const errorMessage =
    error instanceof Error ? error.message : String(error ?? 'Unknown error');
  const normalized = errorMessage.toLowerCase();

  for (const pattern of NON_RETRYABLE_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        retryable: false,
        errorCode: 'NON_RETRYABLE_ERROR',
        errorMessage,
      };
    }
  }

  for (const pattern of RETRYABLE_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        retryable: true,
        errorCode: 'TRANSIENT_ERROR',
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

  return {
    retryable: false,
    errorCode: 'UNCLASSIFIED_ERROR',
    errorMessage,
  };
}

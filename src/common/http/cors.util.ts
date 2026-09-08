import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

export interface CorsConfig {
  origins: string[];
  allowAll: boolean;
  credentials: boolean;
}

/** Headers sent by public/flashcards.html and public/worksheets.html (plus standard ones). */
export const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'Accept',
  'Accept-Language',
  'Origin',
  'X-Requested-With',
  // Frontend tracing / content-restriction headers (trigger preflight if omitted)
  'x-trace-id',
  'x-correlation-id',
  'x-country-code',
] as const;

export function buildCorsOptions(cors: CorsConfig): CorsOptions {
  const allowed = new Set(cors.origins.map((origin) => origin.replace(/\/$/, '')));

  return {
    origin: cors.allowAll
      ? true
      : (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
          if (!origin) {
            callback(null, true);
            return;
          }
          callback(null, allowed.has(origin.replace(/\/$/, '')));
        },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    exposedHeaders: ['Content-Disposition'],
    credentials: cors.credentials,
    maxAge: 86400,
    optionsSuccessStatus: 204,
  };
}

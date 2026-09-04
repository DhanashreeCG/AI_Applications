import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

export interface CorsConfig {
  origins: string[];
  allowAll: boolean;
  credentials: boolean;
}

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
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
    ],
    exposedHeaders: ['Content-Disposition'],
    credentials: cors.credentials,
    maxAge: 86400,
    optionsSuccessStatus: 204,
  };
}

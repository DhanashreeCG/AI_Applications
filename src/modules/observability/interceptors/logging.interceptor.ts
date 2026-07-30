import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';
import { StructuredLoggerService } from '../structured-logger.service';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new StructuredLoggerService('HttpRequest');

  public intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = Date.now();
    const traceId =
      (request.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log('HTTP request completed', {
            trace_id: traceId,
            http_method: request.method,
            http_path: request.originalUrl ?? request.url,
            http_status: response.statusCode,
            duration_ms: Date.now() - startedAt,
            status: 'success',
          });
        },
        error: (error: unknown) => {
          const status =
            typeof error === 'object' &&
            error !== null &&
            'status' in error &&
            typeof (error as { status: unknown }).status === 'number'
              ? (error as { status: number }).status
              : 500;

          this.logger.error(
            'HTTP request failed',
            {
              trace_id: traceId,
              http_method: request.method,
              http_path: request.originalUrl ?? request.url,
              http_status: status,
              duration_ms: Date.now() - startedAt,
              status: 'failed',
            },
            error,
          );
        },
      }),
    );
  }
}

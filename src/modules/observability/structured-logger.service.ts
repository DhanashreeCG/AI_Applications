import { Injectable, Optional } from '@nestjs/common';
import {
  LogLevel,
  StructuredLogEntry,
  StructuredLogFields,
} from './interfaces/structured-log.interface';

@Injectable()
export class StructuredLoggerService {
  constructor(@Optional() private readonly defaultContext?: string) {}

  public log(
    message: string,
    fields?: StructuredLogFields,
    context?: string,
  ): void {
    this.write('info', message, fields, context);
  }

  public warn(
    message: string,
    fields?: StructuredLogFields,
    context?: string,
  ): void {
    this.write('warn', message, fields, context);
  }

  public error(
    message: string,
    fields?: StructuredLogFields,
    error?: unknown,
    context?: string,
  ): void {
    const enriched: StructuredLogFields = { ...fields };

    if (error instanceof Error) {
      enriched.error_message = error.message;
      if (error.stack) {
        enriched.stack_trace = error.stack;
      }
    } else if (error !== undefined) {
      enriched.error_message = String(error);
    }

    this.write('error', message, enriched, context);
  }

  public debug(
    message: string,
    fields?: StructuredLogFields,
    context?: string,
  ): void {
    this.write('debug', message, fields, context);
  }

  public child(context: string): StructuredLoggerService {
    return new StructuredLoggerService(context);
  }

  private write(
    level: LogLevel,
    message: string,
    fields?: StructuredLogFields,
    context?: string,
  ): void {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: context ?? this.defaultContext,
      ...fields,
    };

    const line = JSON.stringify(entry);

    switch (level) {
      case 'error':
        console.error(line);
        break;
      case 'warn':
        console.warn(line);
        break;
      case 'debug':
        console.debug(line);
        break;
      default:
        console.log(line);
    }
  }
}

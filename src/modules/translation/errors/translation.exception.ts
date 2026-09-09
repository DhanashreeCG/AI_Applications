import { HttpException, HttpStatus } from '@nestjs/common';

export type TranslationErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_LANGUAGE'
  | 'TRANSLATION_DISABLED'
  | 'TRANSLATION_UNAVAILABLE'
  | 'TRANSLATION_FAILED';

export class TranslationException extends HttpException {
  constructor(
    public readonly code: TranslationErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: Record<string, unknown>,
  ) {
    super(
      {
        error: {
          code,
          message,
          details: details ?? null,
        },
      },
      status,
    );
    this.message = message;
  }
}

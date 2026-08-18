import { HttpException, HttpStatus } from '@nestjs/common';
import { WorksheetErrorCode } from '../types/worksheet.types';

export class WorksheetException extends HttpException {
  constructor(
    public readonly code: WorksheetErrorCode,
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

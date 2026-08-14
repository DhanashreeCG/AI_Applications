import { HttpException, HttpStatus } from '@nestjs/common';
import { FlashcardErrorCode } from '../interfaces/flashcard.interfaces';

export class FlashcardException extends HttpException {
  constructor(
    public readonly code: FlashcardErrorCode,
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
    // Nest HttpException.initMessage() only reads a top-level `message`
    // field; without it, Error.message becomes the class name
    // ("Flashcard Exception"). Keep the HTTP body shape unchanged while
    // making logs / getErrorMessage() show the real diagnostic text.
    this.message = message;
  }
}

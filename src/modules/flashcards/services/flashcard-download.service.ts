import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FlashcardException } from '../errors/flashcard.exception';
import { GenerateFlashcardsResponse } from '../interfaces/flashcard.interfaces';
import { FlashcardPdfService } from '../flashcard-renderer/pdf/flashcard-pdf.service';
import { FlashcardPersistenceService } from './flashcard-persistence.service';

export interface FlashcardDownloadResult {
  buffer: Buffer;
  format: 'pdf' | 'png' | 'webp';
  contentType: string;
  fileName: string;
}

@Injectable()
export class FlashcardDownloadService {
  private readonly apiBaseUrl: string;

  constructor(
    private readonly persistence: FlashcardPersistenceService,
    private readonly pdfService: FlashcardPdfService,
    configService: ConfigService,
  ) {
    this.apiBaseUrl = (
      configService.get<string>('flashcards.renderer.apiBaseUrl') ||
      `http://127.0.0.1:${configService.get<number>('port') || 5000}`
    ).replace(/\/$/, '');
  }

  public async downloadFromPayload(
    payload: GenerateFlashcardsResponse,
    format: 'pdf' | 'png' | 'webp',
    cardIndex?: number,
  ): Promise<FlashcardDownloadResult> {
    this.assertFormat(format);
    try {
      const captured = await this.pdfService.captureUiCards({
        payload,
        pageUrl: `${this.apiBaseUrl}/flashcards.html`,
        apiBaseUrl: this.apiBaseUrl,
        format,
        cardIndex,
      });
      return {
        buffer: captured.buffer,
        format,
        contentType: captured.contentType,
        fileName: captured.fileName,
      };
    } catch (error) {
      throw new FlashcardException(
        'DOWNLOAD_NOT_IMPLEMENTED',
        error instanceof Error
          ? error.message
          : 'Could not capture flashcard UI for download',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  public async download(
    flashcardSetId: string,
    format: 'pdf' | 'png' | 'webp',
    cardIndex?: number,
  ): Promise<FlashcardDownloadResult> {
    const set = await this.persistence.getById(flashcardSetId);
    return this.downloadFromPayload(set, format, cardIndex);
  }

  private assertFormat(format: string): asserts format is 'pdf' | 'png' | 'webp' {
    if (format !== 'pdf' && format !== 'png' && format !== 'webp') {
      throw new FlashcardException(
        'UNSUPPORTED_FORMAT',
        'Download is only available for pdf, png, or webp',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}

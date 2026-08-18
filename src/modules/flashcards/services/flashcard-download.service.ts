import { HttpStatus, Injectable } from '@nestjs/common';
import { FlashcardException } from '../errors/flashcard.exception';
import { GenerateFlashcardsResponse } from '../interfaces/flashcard.interfaces';
import { FlashcardRendererService } from '../flashcard-renderer/renderer/flashcard-renderer.service';
import { FlashcardPersistenceService } from './flashcard-persistence.service';

export interface FlashcardDownloadResult {
  buffer: Buffer;
  format: 'pdf' | 'png' | 'webp';
  contentType: string;
  fileName: string;
}

@Injectable()
export class FlashcardDownloadService {
  constructor(
    private readonly persistence: FlashcardPersistenceService,
    private readonly rendererService: FlashcardRendererService,
  ) {}

  public async downloadFromPayload(
    payload: GenerateFlashcardsResponse,
    format: 'pdf' | 'png' | 'webp',
    cardIndex?: number,
  ): Promise<FlashcardDownloadResult> {
    this.assertFormat(format);
    const rendered = await this.rendererService.renderDownload(
      payload,
      format,
      cardIndex,
    );
    return {
      buffer: rendered.buffer,
      format,
      contentType: rendered.contentType,
      fileName: rendered.fileName,
    };
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

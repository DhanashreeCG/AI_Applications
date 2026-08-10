import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerateFlashcardsResponse } from '../../interfaces/flashcard.interfaces';
import { parseLayoutDefinition } from '../../utils/template-layout.util';
import {
  FlashcardRenderContext,
  FlashcardRenderResult,
} from '../interfaces/render-result.interface';
import { FlashcardPdfService } from '../pdf/flashcard-pdf.service';
import { CardRenderer } from '../renderer/card.renderer';
import { ComponentRenderer } from '../renderer/component.renderer';
import { RegionRenderer } from '../renderer/region.renderer';
import { FlashcardStorageService } from '../storage/flashcard-storage.service';
import { mapWithConcurrency } from '../utils/concurrency.util';
import { renderDocument } from '../utils/html.util';
import { resolvePageDimensions } from '../utils/page-dimensions.util';
import { loadFlashcardStylesheet } from '../utils/stylesheet.util';

@Injectable()
export class FlashcardRendererService {
  private readonly logger = new Logger(FlashcardRendererService.name);
  private readonly enabled: boolean;
  private readonly concurrency: number;
  private readonly apiBaseUrl: string;
  private readonly cardRenderer: CardRenderer;
  private cachedCss: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly pdfService: FlashcardPdfService,
    private readonly storageService: FlashcardStorageService,
  ) {
    this.enabled =
      this.configService.get<boolean>('flashcards.renderer.enabled') !== false;
    this.concurrency =
      this.configService.get<number>('flashcards.renderer.concurrency') ?? 4;
    this.apiBaseUrl =
      this.configService.get<string>('flashcards.renderer.apiBaseUrl') ??
      'http://localhost:3000';

    const componentRenderer = new ComponentRenderer();
    const regionRenderer = new RegionRenderer(componentRenderer);
    this.cardRenderer = new CardRenderer(regionRenderer);
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  async render(
    response: GenerateFlashcardsResponse,
  ): Promise<FlashcardRenderResult> {
    if (!this.enabled) {
      throw new ServiceUnavailableException(
        'Flashcard renderer is disabled (FLASHCARD_RENDERER_ENABLED=false)',
      );
    }

    const startedAt = Date.now();
    const warnings: string[] = [];
    const normalizeStartedAt = Date.now();

    const layout = parseLayoutDefinition(response.layoutDefinition);
    const dimensions = resolvePageDimensions(
      response.template.pageSize,
      response.template.orientation,
    );
    const requestId =
      response.metadata.requestId ||
      response.metadata.executionId ||
      randomUUID();

    const context: FlashcardRenderContext = {
      apiBaseUrl: this.apiBaseUrl,
      pageWidth: dimensions.width,
      pageHeight: dimensions.height,
      warnings,
      template: response.template,
      request: response.request,
    };

    const normalizeMs = Date.now() - normalizeStartedAt;
    const htmlStartedAt = Date.now();
    const css = this.getStylesheet();
    const cardsHtml = response.cards.map((card) =>
      this.cardRenderer.render(card, layout, context),
    );
    const htmlMs = Date.now() - htmlStartedAt;
    const browserStartedAt = Date.now();

    const renderedCards = await mapWithConcurrency(
      response.cards,
      this.concurrency,
      async (card, index) => {
        const html = renderDocument({
          title: `Flashcard ${card.cardIndex}`,
          css,
          bodyHtml: `<div class="flashcard-stage">${cardsHtml[index]}</div>`,
        });

        const buffer = await this.pdfService.renderWebpFromHtml({
          html,
          width: dimensions.width,
          height: dimensions.height,
        });

        const fileName = `card-${card.cardIndex}.webp`;
        const stored = await this.storageService.saveFile({
          requestId,
          fileName,
          buffer,
          contentType: 'image/webp',
        });

        return {
          cardIndex: card.cardIndex,
          cardId: card.cardId,
          fileName,
          path: stored.path,
          uri: stored.uri,
        };
      },
    );

    const browserMs = Date.now() - browserStartedAt;

    const preview = cardsHtml.length
      ? await this.storageService.saveFile({
          requestId,
          fileName: 'preview.webp',
          buffer: await this.pdfService.renderWebpFromHtml({
            html: renderDocument({
              title: 'Flashcard Preview',
              css,
              bodyHtml: `<div class="flashcard-stage">${cardsHtml[0]}</div>`,
            }),
            width: dimensions.width,
            height: dimensions.height,
          }),
          contentType: 'image/webp',
        })
      : { path: '', uri: '' };

    const pdfStartedAt = Date.now();
    const pdf = await this.storageService.saveFile({
      requestId,
      fileName: 'flashcards.pdf',
      buffer: await this.pdfService.renderPdfFromCards({
        title: `Flashcards ${requestId}`,
        cardsHtml: cardsHtml.join('\n'),
        width: dimensions.width,
        height: dimensions.height,
      }),
      contentType: 'application/pdf',
    });
    const pdfMs = Date.now() - pdfStartedAt;
    const totalMs = Date.now() - startedAt;

    this.logger.log(
      `Rendered ${renderedCards.length} cards for ${requestId} via ${this.storageService.getBackendType()} in ${totalMs}ms (html=${htmlMs}ms browser=${browserMs}ms pdf=${pdfMs}ms)`,
    );

    if (warnings.length) {
      this.logger.warn(
        `Render warnings for ${requestId}: ${warnings.slice(0, 5).join('; ')}`,
      );
    }

    return {
      storageBackend: this.storageService.getBackendType(),
      requestId,
      outputLocation: this.storageService.resolveOutputLocation(requestId),
      cards: renderedCards,
      preview,
      pdf,
      timing: {
        normalizeMs,
        htmlMs,
        browserMs,
        pdfMs,
        totalMs,
      },
      warnings,
    };
  }

  private getStylesheet(): string {
    if (!this.cachedCss) {
      this.cachedCss = loadFlashcardStylesheet();
    }

    return this.cachedCss;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { GenerateFlashcardsResponse } from '../../interfaces/flashcard.interfaces';
import { BrowserPoolService } from '../browser/browser-pool.service';
import { renderDocument } from '../utils/html.util';
import { loadFlashcardStylesheet } from '../utils/stylesheet.util';

const EXPORT_CARD_WIDTH = 900;

@Injectable()
export class FlashcardPdfService {
  private readonly logger = new Logger(FlashcardPdfService.name);

  constructor(private readonly browserPool: BrowserPoolService) {}

  async renderImageFromHtml(params: {
    html: string;
    width: number;
    height: number;
    type: 'png' | 'webp';
  }): Promise<Buffer> {
    const browser = await this.browserPool.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setViewportSize({
        width: params.width,
        height: params.height,
      });
      await page.setContent(params.html, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);

      const screenshot = await page.screenshot({
        type: params.type,
        fullPage: false,
      });

      return screenshot;
    } finally {
      await page.close();
    }
  }

  async renderWebpFromHtml(params: {
    html: string;
    width: number;
    height: number;
  }): Promise<Buffer> {
    return this.renderImageFromHtml({ ...params, type: 'webp' });
  }

  async renderPdfFromCards(params: {
    title: string;
    cardsHtml: string;
    width: number;
    height: number;
  }): Promise<Buffer> {
    const browser = await this.browserPool.getBrowser();
    const page = await browser.newPage();
    const css = loadFlashcardStylesheet();
    const html = renderDocument({
      title: params.title,
      css,
      bodyHtml: `<div class="flashcard-stage flashcard-stage--pdf">${params.cardsHtml}</div>`,
    });

    try {
      await page.setContent(html, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);

      const pdf = await page.pdf({
        width: `${params.width}px`,
        height: `${params.height}px`,
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });

      return Buffer.from(pdf);
    } catch (error) {
      this.logger.warn(`PDF generation failed: ${String(error)}`);
      throw error;
    } finally {
      await page.close();
    }
  }

  async captureUiCards(params: {
    payload: GenerateFlashcardsResponse;
    pageUrl: string;
    apiBaseUrl: string;
    format: 'png' | 'webp' | 'pdf';
    cardIndex?: number;
  }): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
    const browser = await this.browserPool.getBrowser();
    const page = await browser.newPage();
    const cardIndex =
      params.cardIndex == null || Number.isNaN(Number(params.cardIndex))
        ? undefined
        : Number(params.cardIndex);

    try {
      await page.setViewportSize({
        width: EXPORT_CARD_WIDTH + 80,
        height: Math.round((EXPORT_CARD_WIDTH * 7) / 5) + 80,
      });
      await page.addInitScript(
        (spec: {
          payload: GenerateFlashcardsResponse;
          cardIndex?: number;
          width: number;
          apiBase: string;
        }) => {
          (
            window as unknown as { __FLASHCARD_CAPTURE__: typeof spec }
          ).__FLASHCARD_CAPTURE__ = spec;
        },
        {
          payload: params.payload,
          cardIndex,
          width: EXPORT_CARD_WIDTH,
          apiBase: params.apiBaseUrl,
        },
      );
      await page.goto(params.pageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await page.waitForFunction(
        () =>
          (window as unknown as { __FLASHCARD_CAPTURE_DONE__?: boolean })
            .__FLASHCARD_CAPTURE_DONE__ === true,
        { timeout: 90000 },
      );
      const captureError = await page.evaluate(
        () =>
          (window as unknown as { __FLASHCARD_CAPTURE_ERROR__?: string })
            .__FLASHCARD_CAPTURE_ERROR__ || '',
      );
      if (captureError) {
        throw new Error(captureError);
      }

      const locators = page.locator('.export-stage .uno');
      const count = await locators.count();
      if (!count) {
        throw new Error('UI capture did not render any flashcards');
      }

      const imageType = params.format === 'webp' ? 'webp' : 'png';
      const screenshots: Buffer[] = [];
      for (let i = 0; i < count; i += 1) {
        const shot = await locators.nth(i).screenshot({
          type: imageType,
          omitBackground: false,
        });
        screenshots.push(Buffer.from(shot));
      }

      const slug =
        (
          params.payload.request?.topic ||
          params.payload.request?.query ||
          'flashcards'
        )
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40) || 'flashcards';

      if (params.format === 'pdf') {
        const pngs: Buffer[] = [];
        for (let i = 0; i < count; i += 1) {
          const shot = await locators.nth(i).screenshot({
            type: 'png',
            omitBackground: false,
          });
          pngs.push(Buffer.from(shot));
        }
        return {
          buffer: await this.pdfFromPngs(pngs),
          contentType: 'application/pdf',
          fileName: `${slug}.pdf`,
        };
      }

      return {
        buffer: screenshots[0],
        contentType: params.format === 'webp' ? 'image/webp' : 'image/png',
        fileName: `${slug}-${cardIndex ?? 0}.${params.format}`,
      };
    } finally {
      await page.close();
    }
  }

  private async pdfFromPngs(pngs: Buffer[]): Promise<Buffer> {
    const browser = await this.browserPool.getBrowser();
    const page = await browser.newPage();
    const images = pngs
      .map(
        (buffer, index) =>
          `<img src="data:image/png;base64,${buffer.toString('base64')}" alt="card ${index + 1}" style="width:100%;display:block;page-break-after:always;page-break-inside:avoid;" />`,
      )
      .join('');
    try {
      await page.setContent(
        `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;background:#fff;} img:last-child{page-break-after:auto;}</style></head><body>${images}</body></html>`,
        { waitUntil: 'load' },
      );
      const size = this.pngSize(pngs[0]);
      const pdf = await page.pdf({
        width: `${size.width}px`,
        height: `${size.height}px`,
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }

  private pngSize(buffer: Buffer): { width: number; height: number } {
    if (buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
      return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
      };
    }
    return {
      width: EXPORT_CARD_WIDTH,
      height: Math.round((EXPORT_CARD_WIDTH * 7) / 5),
    };
  }
}

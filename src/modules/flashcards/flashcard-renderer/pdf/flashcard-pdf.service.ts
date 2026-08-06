import { Injectable, Logger } from '@nestjs/common';
import { BrowserPoolService } from '../browser/browser-pool.service';
import { renderDocument } from '../utils/html.util';
import { loadFlashcardStylesheet } from '../utils/stylesheet.util';

@Injectable()
export class FlashcardPdfService {
  private readonly logger = new Logger(FlashcardPdfService.name);

  constructor(private readonly browserPool: BrowserPoolService) {}

  async renderWebpFromHtml(params: {
    html: string;
    width: number;
    height: number;
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
        type: 'webp',
        fullPage: false,
      });

      return screenshot;
    } finally {
      await page.close();
    }
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
}

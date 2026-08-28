import { Injectable } from '@nestjs/common';
import { WorksheetRenderer } from './worksheet-renderer.interface';
import { WorksheetRenderInput } from '../types/worksheet.types';
import { GenericWorksheetRenderer } from './generic-worksheet.renderer';
import { buildScatterItemsMarkup } from '../utils/template-tokens.util';

@Injectable()
export class CircleTheThingsRenderer implements WorksheetRenderer {
  readonly type = 'circle_the_things';

  constructor(private readonly genericRenderer: GenericWorksheetRenderer) {}

  render(input: WorksheetRenderInput): string {
    let html = this.genericRenderer.render(input);
    if (/data-item-id=/i.test(html)) {
      return html;
    }
    const itemsHtml = buildScatterItemsMarkup(input.structure, input.pencilIconUrl);
    if (!itemsHtml) {
      return html;
    }
    if (/class=["'][^"']*\bactivity-box\b/i.test(html)) {
      return html.replace(
        /(<(?:[a-z0-9-]+)[^>]*class=["'][^"']*\bactivity-box\b[^"']*["'][^>]*>)/i,
        `$1\n${itemsHtml}\n`,
      );
    }
    return html.replace(/(<\/main>)/i, `\n${itemsHtml}\n$1`);
  }
}

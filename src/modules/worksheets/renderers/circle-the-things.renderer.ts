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
    const genericInput = {
      ...input,
      templateHtml: input.templateHtml.replace(/\{\{\{?\s*items\s*\}?\}\}/ig, '{{ITEMS_PLACEHOLDER}}'),
      structure: { ...input.structure } as Record<string, unknown>,
    };
    delete genericInput.structure['items'];
    
    let html = this.genericRenderer.render(genericInput);
    if (/data-item-id=/i.test(html)) {
      return html;
    }
    const itemsHtml = buildScatterItemsMarkup(input.structure, input.pencilIconUrl, input.templateHtml);
    if (!itemsHtml) {
      return html;
    }
    
    // Remove the placeholder if it was injected
    html = html.replace('{{ITEMS_PLACEHOLDER}}', '');
    
    if (/class=["'][^"']*\bactivity-box\b/i.test(html)) {
      return html.replace(
        /(<(?:[a-z0-9-]+)[^>]*class=["'][^"']*\bactivity-box\b[^"']*["'][^>]*>)/i,
        `$1\n${itemsHtml}\n`,
      );
    }
    return html.replace(/(<\/main>)/i, `\n${itemsHtml}\n$1`);
  }
}

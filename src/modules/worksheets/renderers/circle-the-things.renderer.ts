import { Injectable } from '@nestjs/common';
import { WorksheetRenderer } from './worksheet-renderer.interface';
import { WorksheetRenderInput, WorksheetRenderMode } from '../types/worksheet.types';
import { GenericWorksheetRenderer, escapeHtml } from './generic-worksheet.renderer';
import { generateScatterPositions } from '../utils/scatter-layout.util';
import { resolveImageSlot } from '../utils/template-tokens.util';
import { visualQueryFromImageRecord } from '../utils/structure.util';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class CircleTheThingsRenderer implements WorksheetRenderer {
  readonly type = 'circle_the_things';

  constructor(private readonly genericRenderer: GenericWorksheetRenderer) {}

  render(input: WorksheetRenderInput): string {
    // 1. Hide items array from generic renderer so it doesn't JSON.stringify them into the HTML,
    // and provide a safe placeholder for injection.
    const genericInput = {
      ...input,
      structure: { ...input.structure, ITEMS: '{{ITEMS_PLACEHOLDER}}' } as Record<string, unknown>,
    };
    delete genericInput.structure['items'];

    // 2. Generate the standard HTML using the generic renderer
    let html = this.genericRenderer.render(genericInput);
    const itemsHtml = this.renderItems(input.structure, input.pencilIconUrl, input.mode);

    // 3. Inject our custom items HTML
    if (html.includes('{{ITEMS_PLACEHOLDER}}')) {
      html = html.replace('{{ITEMS_PLACEHOLDER}}', itemsHtml);
    } else {
       // fallback if the template doesn't explicitly have an {{ITEMS}} token but has an activity box
       if (/class=["'][^"']*\bactivity-box\b/i.test(html)) {
         html = html.replace(/(<[a-z0-9-]+[^>]*class=["'][^"']*\bactivity-box\b[^"']*["'][^>]*>)/i, `$1\n${itemsHtml}\n`);
       } else {
         console.log("WARNING: circle_the_things html did not contain {{ITEMS_PLACEHOLDER}} or class='activity-box'.");
         // Inject before closing main tag as last resort
         html = html.replace(/(<\/main>)/i, `\n${itemsHtml}\n$1`);
       }
    }

    return html;
  }

  private renderItems(structure: Record<string, unknown>, pencilIconUrl = '', mode?: WorksheetRenderMode): string {
    const items = Array.isArray(structure.items) ? structure.items : [];
    if (items.length === 0) {
      return '';
    }

    // Default layout dimensions based on the template
    const box = { left: 80, top: 330, width: 860, height: 760 };
    const itemSize = { width: 160, height: 160 };

    const positions = generateScatterPositions(items.length, box, itemSize);
    
    let html = '';
    
    items.forEach((item, index) => {
      if (!isRecord(item)) return;

      const pos = positions[index] || { top: 0, left: 0 };
      const label = typeof item.label === 'string' ? item.label : '';
      const path = `items[${index}]`;

      // Resolve image source
      const slotMatch = resolveImageSlot(structure, path);
      const slotId = slotMatch?.slotId || `items[${index}]`;
      const record = isRecord(item) ? item : {};
      const rawSrc = (typeof record.assetUrl === 'string' && record.assetUrl) || 
                     (typeof record.imageUrl === 'string' && record.imageUrl) || '';
      
      const srcAttr = rawSrc ? ` src="${escapeHtml(rawSrc)}"` : '';
      const alt = slotMatch?.imageQuery || visualQueryFromImageRecord(record) || label || slotId;
      
      // Determine if correct/incorrect to add data attribute (might be useful for interactive apps later)
      const isCorrect = item.is_correct === true;

      // Pencil icon for the whole item
      const pencil = pencilIconUrl
        ? `<button class="ai-pencil" data-pencil-for="${escapeHtml(path)}" type="button" title="AI regenerate" style="position:absolute; top:-10px; right:-10px; width:30px; height:30px; z-index:3;">
             <img src="${escapeHtml(pencilIconUrl)}" width="30" height="30">
           </button>`
        : '';

      html += `
        <div class="item" style="position:absolute; top:${pos.top}px; left:${pos.left}px; width:${itemSize.width}px; height:${itemSize.height}px;" data-item-id="${escapeHtml(path)}" data-correct="${isCorrect}">
          ${pencil}
          <div style="width:100%; height:130px; display:flex; justify-content:center; align-items:center;">
            <img class="worksheet-image" ${srcAttr} alt="${escapeHtml(alt)}" data-image-slot="${escapeHtml(slotId)}" data-field-path="${escapeHtml(path)}" style="max-width:130px; max-height:130px; object-fit:contain;" />
          </div>
          <div class="item-label" data-editable="${escapeHtml(`${path}.label`)}" data-field-path="${escapeHtml(`${path}.label`)}" style="text-align:center; font-size:24px; font-weight:bold; color:#222; margin-top:5px; height:30px;">
            ${escapeHtml(label)}
          </div>
        </div>
      `;
    });

    return html;
  }
}

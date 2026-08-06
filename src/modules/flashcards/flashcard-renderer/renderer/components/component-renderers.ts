import { EditableComponentPayload } from '../../../interfaces/flashcard.interfaces';
import { FlashcardRenderContext } from '../../interfaces/render-result.interface';
import { escapeHtml, renderElement } from '../../utils/html.util';
import { resolveImageSource } from '../../utils/image-source.util';

export function renderImageComponent(
  component: EditableComponentPayload,
  context: FlashcardRenderContext,
  isOverlay = false,
): string {
  const source = resolveImageSource(component.assetReference, context.apiBaseUrl);

  if (source) {
    const img = renderElement('img', {
      src: source,
      alt: component.assetReference?.caption || '',
      loading: 'eager',
    });

    return renderElement(
      'div',
      {
        class: isOverlay ? 'uno-figure uno-bubble' : 'uno-figure',
        'data-component-id': component.componentId,
        'data-component-type': component.componentType,
      },
      img,
    );
  }

  context.warnings.push(
    `Image missing for component ${component.componentId}; rendered placeholder`,
  );

  const placeholder = `
    <div class="fig-fallback">
      <div class="glyph" aria-hidden="true">🖼</div>
      <small>Image unavailable</small>
    </div>`;

  return renderElement(
    'div',
    {
      class: isOverlay ? 'uno-figure uno-bubble' : 'uno-figure',
      'data-component-id': component.componentId,
      'data-component-type': component.componentType,
    },
    placeholder,
  );
}

export function renderTextComponent(
  component: EditableComponentPayload,
  cssClass: string,
  isOverlay = false,
): string {
  const isLongHero = cssClass === 'uno-hero' && (component.content || '').length > 4;
  const isLongCaption = cssClass === 'u-caption' && (component.content || '').length > 12;
  const isLong = isLongHero || isLongCaption;
  let finalClass = isLong ? `${cssClass} long` : cssClass;
  if (isOverlay) {
    finalClass += ' uno-bubble';
  }

  return renderElement(
    'div',
    {
      class: finalClass,
      'data-component-id': component.componentId,
      'data-component-type': component.componentType,
    },
    escapeHtml(component.content ?? ''),
  );
}

export function renderCalloutComponent(
  component: EditableComponentPayload,
  cssClass: string,
  tag: string,
  isOverlay = false,
): string {
  const inner = `${renderElement('span', { class: 'tag' }, escapeHtml(tag))}<span>${escapeHtml(component.content ?? '')}</span>`;

  return renderElement(
    'div',
    {
      class: `u-note ${cssClass}${isOverlay ? ' uno-bubble' : ''}`,
      'data-component-id': component.componentId,
      'data-component-type': component.componentType,
    },
    inner,
  );
}

function parseChipValues(content: string): string[] {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((value) => String(value).trim())
          .filter((value) => value.length > 0);
      }
    } catch {
      // Fall through to delimiter parsing.
    }
  }

  return trimmed
    .split(/[,|]/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function renderChipsComponent(
  component: EditableComponentPayload,
  isOverlay = false,
): string {
  const values = parseChipValues(component.content ?? '');
  const chips = values
    .map((value) => renderElement('span', { class: 'comp-chip' }, escapeHtml(value)))
    .join('');

  return renderElement(
    'div',
    {
      class: `comp-chips${isOverlay ? ' uno-bubble' : ''}`,
      'data-component-id': component.componentId,
      'data-component-type': component.componentType,
    },
    chips,
  );
}

export function renderOptionsComponent(
  component: EditableComponentPayload,
  isOverlay = false,
): string {
  const rawOptions = (component as any).options;
  const list = Array.isArray(rawOptions) ? rawOptions : [];
  if (!list.length) {
    if (component.content) {
      return renderTextComponent(component, 'u-sentence', isOverlay);
    }
    return `
      <div class="comp-placeholder">
        Options: ${escapeHtml(component.componentId)}
      </div>`;
  }

  const rows = list.map((entry: any, index: number) => {
    const text = typeof entry === 'string'
      ? String.fromCharCode(65 + index) + '. ' + entry
      : (entry.label || entry.text || entry.content || entry.value || '');
    return renderElement('div', { class: 'comp-option' }, escapeHtml(text));
  }).join('\n');

  return renderElement(
    'div',
    {
      class: `comp-options${isOverlay ? ' uno-bubble' : ''}`,
      'data-component-id': component.componentId,
      'data-component-type': component.componentType,
    },
    rows,
  );
}

export function renderImageCollectionComponent(
  component: EditableComponentPayload,
  context: FlashcardRenderContext,
  isOverlay = false,
): string {
  const rawItems = (component as any).items || (component as any).images || (component as any).collection || (component as any).assetReferences;
  const items = Array.isArray(rawItems) ? rawItems : [];
  const layoutType = (context.template?.layoutType || 'VERTICAL').toUpperCase();

  const buildCellHtml = (item: any, index: number): string => {
    const cellComponent: EditableComponentPayload = {
      componentId: `${component.componentId}_${index + 1}`,
      type: 'image',
      componentType: 'image',
      editable: component.editable,
      content: item.content || item.caption || null,
      assetReference: item.assetReference || (item.imageUrl || item.signedUrl ? item : null),
    };
    const figHtml = renderImageComponent(cellComponent, context);
    const caption = item.caption || item.content || item.label || '';
    const labelHtml = caption
      ? renderElement('div', { class: 'cell-label' }, escapeHtml(caption))
      : '';
    return renderElement('div', { class: 'uno-cell' }, figHtml + labelHtml);
  };

  if (layoutType === 'GRID') {
    const cells = items.slice(0, 4).map((item, index) => buildCellHtml(item, index)).join('\n');
    return renderElement(
      'div',
      {
        class: `uno-cells quad${isOverlay ? ' uno-bubble' : ''}`,
        'data-component-id': component.componentId,
        'data-component-type': component.componentType,
      },
      cells,
    );
  }

  if (layoutType === 'TWO_COLUMN') {
    const cells = items.slice(0, 2).map((item, index) => buildCellHtml(item, index)).join('\n');
    return renderElement(
      'div',
      {
        class: `uno-cells duo${isOverlay ? ' uno-bubble' : ''}`,
        'data-component-id': component.componentId,
        'data-component-type': component.componentType,
      },
      cells,
    );
  }

  const cells = items.map((item, index) => {
    const cellComponent: EditableComponentPayload = {
      componentId: `${component.componentId}_${index + 1}`,
      type: 'image',
      componentType: 'image',
      editable: component.editable,
      content: item.content || item.caption || null,
      assetReference: item.assetReference || (item.imageUrl || item.signedUrl ? item : null),
    };
    const figHtml = renderImageComponent(cellComponent, context);
    const caption = item.caption || item.content || item.label || '';
    const labelHtml = caption
      ? renderElement('div', { class: 'cell-label' }, escapeHtml(caption))
      : '';
    return renderElement('div', { class: 'uno-cell' }, figHtml + labelHtml);
  }).join('\n');

  return renderElement(
    'div',
    {
      class: `uno-cells${isOverlay ? ' uno-bubble' : ''}`,
      style: 'flex-direction:column;gap:1.6cqw;',
      'data-component-id': component.componentId,
      'data-component-type': component.componentType,
    },
    cells,
  );
}

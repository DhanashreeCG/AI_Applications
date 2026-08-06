import { EditableComponentPayload } from '../../../interfaces/flashcard.interfaces';
import { FlashcardRenderContext } from '../../interfaces/render-result.interface';
import { escapeHtml, renderElement } from '../../utils/html.util';
import { resolveImageSource } from '../../utils/image-source.util';

export function renderImageComponent(
  component: EditableComponentPayload,
  context: FlashcardRenderContext,
): string {
  const source = resolveImageSource(component.assetReference, context.apiBaseUrl);

  if (source) {
  const img = renderElement('img', {
    src: source,
    alt: component.assetReference?.caption || '',
    width: 500,
    height: 500,
    loading: 'eager',
  });

    return renderElement(
      'div',
      {
        class: 'flashcard-image',
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
    <div class="flashcard-image__placeholder">
      <div class="flashcard-image__placeholder-glyph" aria-hidden="true">🖼</div>
      <div class="flashcard-image__placeholder-text">Image unavailable</div>
    </div>`;

  return renderElement(
    'div',
    {
      class: 'flashcard-image',
      'data-component-id': component.componentId,
      'data-component-type': component.componentType,
    },
    placeholder,
  );
}

export function renderTextComponent(
  component: EditableComponentPayload,
  cssClass: string,
): string {
  return renderElement(
    'div',
    {
      class: cssClass,
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
): string {
  const inner = `${renderElement('span', { class: 'tag' }, escapeHtml(tag))}<span>${escapeHtml(component.content ?? '')}</span>`;

  return renderElement(
    'div',
    {
      class: `c-callout ${cssClass}`,
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
): string {
  const values = parseChipValues(component.content ?? '');
  const chips = values
    .map((value) => renderElement('span', { class: 'chip' }, escapeHtml(value)))
    .join('');

  return renderElement(
    'div',
    {
      class: 'c-chips',
      'data-component-id': component.componentId,
      'data-component-type': component.componentType,
    },
    chips,
  );
}

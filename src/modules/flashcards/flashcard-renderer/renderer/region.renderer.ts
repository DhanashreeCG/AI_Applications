import {
  EditableComponentPayload,
  TemplateLayoutRegion,
} from '../../interfaces/flashcard.interfaces';
import { FlashcardRenderContext } from '../interfaces/render-result.interface';
import { renderElement } from '../utils/html.util';
import { ComponentRenderer } from './component.renderer';

export class RegionRenderer {
  constructor(private readonly componentRenderer: ComponentRenderer) {}

  render(
    region: TemplateLayoutRegion,
    componentsById: Map<string, EditableComponentPayload>,
    context: FlashcardRenderContext,
  ): string {
    const regionId = region.id.toLowerCase();
    const renderedComponents = region.components
      .map((layoutComponent) =>
        this.componentRenderer.render(
          layoutComponent,
          componentsById.get(layoutComponent.id),
          context,
          regionId === 'overlay',
        ),
      )
      .filter((html) => html.length > 0)
      .join('\n');

    if (!renderedComponents && regionId !== 'header') {
      return '';
    }

    let regionClass = '';
    let innerHtml = renderedComponents;

    if (regionId === 'header') {
      regionClass = 'uno-top';
      const subjectComp = componentsById.get('subject');
      const subjectText = subjectComp?.content || '';
      const marks = /number|count|math|shape/i.test(subjectText) ? ['1', '2', '3'] : ['A', 'B', 'C'];
      const logo = `<span class="uno-logo" aria-hidden="true"><span>${marks[0]}</span><span>${marks[1]}</span><span>${marks[2]}</span></span>`;
      innerHtml += logo;
    } else if (regionId === 'body') {
      regionClass = 'uno-main';
    } else if (regionId === 'footer' || regionId === 'bottom') {
      regionClass = 'uno-text';
    } else {
      regionClass = `uno-region uno-region--${sanitizeRegionClass(region.id)}`;
    }

    const styleAttr = getRegionStyleAttribute(region);
    const attributes: Record<string, string> = {
      class: `layout-region ${regionClass}`,
      'data-region-id': region.id,
    };
    if (styleAttr) {
      attributes.style = styleAttr;
    }
    if (region.visibility === false || region.visible === false) {
      attributes.class += ' hidden';
    }

    return renderElement(
      'section',
      attributes,
      innerHtml,
    );
  }
}

function sanitizeRegionClass(regionId: string): string {
  return regionId.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
}

function getRegionStyleAttribute(region: TemplateLayoutRegion): string {
  const styles: string[] = [];
  if (region.flex != null) {
    styles.push(`flex:${region.flex}`);
  }
  if (region.gap != null) {
    const gapVal = typeof region.gap === 'number' ? `${region.gap}cqw` : region.gap;
    styles.push(`gap:${gapVal}`);
  }
  if (region.padding != null) {
    const paddingVal = typeof region.padding === 'number' ? `${region.padding}cqw` : region.padding;
    styles.push(`padding:${paddingVal}`);
  }
  if (region.background) {
    styles.push(`background:${region.background}`);
  }
  if (region.border) {
    styles.push(`border:${region.border}`);
  }
  if (region.alignment) {
    const parts = String(region.alignment).trim().split(/\s+/);
    if (parts[0]) {
      styles.push(`justify-content:${parts[0]}`);
    }
    if (parts[1]) {
      styles.push(`align-items:${parts[1]}`);
    } else if (parts[0]) {
      styles.push(`align-items:${parts[0]}`);
    }
  }
  if (region.orientation === 'horizontal') {
    styles.push('flex-direction:row');
  } else if (region.orientation === 'vertical') {
    styles.push('flex-direction:column');
  }
  return styles.length > 0 ? styles.join(';') : '';
}

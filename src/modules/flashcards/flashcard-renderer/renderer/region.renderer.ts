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
    const renderedComponents = region.components
      .map((layoutComponent) =>
        this.componentRenderer.render(
          layoutComponent,
          componentsById.get(layoutComponent.id),
          context,
        ),
      )
      .filter((html) => html.length > 0)
      .join('\n');

    if (!renderedComponents) {
      return '';
    }

    const regionId = region.id.toLowerCase();
    let regionClass = '';
    let innerHtml = renderedComponents;

    if (regionId === 'header') {
      regionClass = 'uno-top';
      const logo = `<span class="uno-logo" aria-hidden="true"><span>A</span><span>B</span><span>C</span></span>`;
      innerHtml += logo;
    } else if (regionId === 'body') {
      regionClass = 'uno-main';
    } else if (regionId === 'footer' || regionId === 'bottom') {
      regionClass = 'uno-text';
    } else {
      regionClass = `uno-region uno-region--${sanitizeRegionClass(region.id)}`;
    }

    return renderElement(
      'section',
      {
        class: regionClass,
        'data-region-id': region.id,
      },
      innerHtml,
    );
  }
}

function sanitizeRegionClass(regionId: string): string {
  return regionId.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
}

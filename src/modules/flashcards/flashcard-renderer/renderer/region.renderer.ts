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

    const regionClass = `flashcard-region flashcard-region--${sanitizeRegionClass(region.id)}`;

    return renderElement(
      'section',
      {
        class: regionClass,
        'data-region-id': region.id,
      },
      renderElement('div', { class: 'flashcard-region__content' }, renderedComponents),
    );
  }
}

function sanitizeRegionClass(regionId: string): string {
  return regionId.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
}

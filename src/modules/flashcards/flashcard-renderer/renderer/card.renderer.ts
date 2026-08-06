import {
  FlashcardCardPayload,
  TemplateLayoutDefinition,
} from '../../interfaces/flashcard.interfaces';
import { FlashcardRenderContext } from '../interfaces/render-result.interface';
import { renderElement } from '../utils/html.util';
import { RegionRenderer } from './region.renderer';

export class CardRenderer {
  constructor(private readonly regionRenderer: RegionRenderer) {}

  render(
    card: FlashcardCardPayload,
    layout: TemplateLayoutDefinition,
    context: FlashcardRenderContext,
  ): string {
    const componentsById = new Map(
      card.components.map((component) => [component.componentId, component]),
    );

    const regions = layout.regions
      .map((region) =>
        this.regionRenderer.render(region, componentsById, context),
      )
      .filter((html) => html.length > 0)
      .join('\n');

    return renderElement(
      'article',
      {
        class: 'flashcard',
        'data-card-id': card.cardId,
        'data-card-index': card.cardIndex,
        style: `width:${context.pageWidth}px;height:${context.pageHeight}px;`,
      },
      regions,
    );
  }
}

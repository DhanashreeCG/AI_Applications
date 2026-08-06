import {
  FlashcardCardPayload,
  TemplateLayoutDefinition,
} from '../../interfaces/flashcard.interfaces';
import { FlashcardRenderContext } from '../interfaces/render-result.interface';
import { renderElement } from '../utils/html.util';
import { RegionRenderer } from './region.renderer';

const THEMES = [
  { frame: '#6d28d9', ink: '#ffffff', tint: 'rgba(109, 40, 217, 0.08)', dash: 'rgba(255, 255, 255, 0.4)', bubble: '#e0245e' },
  { frame: '#e0245e', ink: '#ffffff', tint: 'rgba(224, 36, 94, 0.08)', dash: 'rgba(255, 255, 255, 0.4)', bubble: '#f5b700' },
  { frame: '#22a06b', ink: '#ffffff', tint: 'rgba(34, 160, 107, 0.08)', dash: 'rgba(255, 255, 255, 0.4)', bubble: '#6d28d9' },
  { frame: '#0ea5e9', ink: '#ffffff', tint: 'rgba(14, 165, 233, 0.08)', dash: 'rgba(255, 255, 255, 0.4)', bubble: '#f5b700' },
  { frame: '#f5b700', ink: '#3a2a00', tint: 'rgba(245, 183, 0, 0.12)', dash: 'rgba(58, 42, 0, 0.2)', bubble: '#e0245e' },
];

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

    const theme = THEMES[card.cardIndex % THEMES.length];

    const sheet = renderElement('div', { class: 'uno-sheet' }, regions);
    const frame = renderElement('div', { class: 'uno-frame' }, sheet);

    return renderElement(
      'article',
      {
        class: 'uno',
        'data-card-id': card.cardId,
        'data-card-index': card.cardIndex,
        style: `width:${context.pageWidth}px;height:${context.pageHeight}px;--frame:${theme.frame};--frame-ink:${theme.ink};--tint:${theme.tint};--dash:${theme.dash};--bubble:${theme.bubble};`,
      },
      frame,
    );
  }
}

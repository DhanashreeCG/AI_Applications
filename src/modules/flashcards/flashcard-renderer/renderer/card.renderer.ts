import {
  FlashcardCardPayload,
  TemplateLayoutDefinition,
  EditableComponentPayload,
} from '../../interfaces/flashcard.interfaces';
import { FlashcardRenderContext } from '../interfaces/render-result.interface';
import { renderElement } from '../utils/html.util';
import { RegionRenderer } from './region.renderer';

const THEMES = [
  { frame: '#FFD233', ink: '#7a5900', tint: '#FFF6D5', dash: 'rgba(255,255,255,.92)', bubble: '#4C1D95' },
  { frame: '#FF3D8B', ink: '#8e0f43', tint: '#FFE6F0', dash: 'rgba(255,255,255,.92)', bubble: '#4C1D95' },
  { frame: '#4FC3F7', ink: '#0b5f83', tint: '#E4F6FE', dash: 'rgba(255,255,255,.95)', bubble: '#1D4ED8' },
  { frame: '#FF5A5F', ink: '#8c1f22', tint: '#FFE9E9', dash: 'rgba(255,255,255,.92)', bubble: '#4C1D95' },
  { frame: '#3DD68C', ink: '#0d6641', tint: '#E3FAEF', dash: 'rgba(255,255,255,.95)', bubble: '#0F766E' },
  { frame: '#A78BFA', ink: '#4a2ca0', tint: '#F1EBFF', dash: 'rgba(255,255,255,.95)', bubble: '#4C1D95' },
];

export class CardRenderer {
  constructor(private readonly regionRenderer: RegionRenderer) {}

  render(
    card: FlashcardCardPayload,
    layout: TemplateLayoutDefinition,
    context: FlashcardRenderContext,
  ): string {
    const componentsMap = new Map(
      card.components.map((component) => [component.componentId, component]),
    );

    // Ensure fallback subject component exists if requested in the layout
    const layoutHasSubjectSlot = layout.regions.some((region) =>
      (region.components || []).some((comp) => comp.id === 'subject'),
    );

    if (layoutHasSubjectSlot && !componentsMap.has('subject')) {
      const template = context.template;
      const request = context.request;
      const content =
        template?.description ||
        humanize(template?.templateType) ||
        template?.name ||
        humanize(request?.learningObjective) ||
        'Flash Card';

      componentsMap.set('subject', {
        componentId: 'subject',
        type: 'title',
        componentType: 'title',
        editable: true,
        content: content,
      });
    }

    // Render all layout regions
    const regionsMap = new Map<string, string>();
    for (const region of layout.regions) {
      const html = this.regionRenderer.render(region, componentsMap, context);
      if (html) {
        regionsMap.set(region.id, html);
      }
    }

    const layoutType = (context.template?.layoutType || 'VERTICAL').toUpperCase();
    let regionsHtmlContent = '';

    const regionsList = layout.regions
      .map((region) => regionsMap.get(region.id))
      .filter((html): html is string => Boolean(html));

    // Handle specific layouts matching LayoutFactory in public/index.html
    if (layoutType === 'HORIZONTAL') {
      regionsHtmlContent = renderElement(
        'div',
        { class: 'layout-root layout-horizontal horizontal' },
        regionsList.join('\n'),
      );
    } else if (layoutType === 'TWO_COLUMN') {
      const leftHtml = regionsMap.get('left') || '';
      const rightHtml = regionsMap.get('right') || '';
      let rowHtml = '';
      if (leftHtml || rightHtml) {
        rowHtml = renderElement(
          'div',
          { class: 'layout-row uno-cells duo' },
          [leftHtml, rightHtml].filter(Boolean).join('\n'),
        );
      }
      const otherRegionsHtml: string[] = [];
      if (rowHtml) {
        otherRegionsHtml.push(rowHtml);
      }
      for (const region of layout.regions) {
        if (region.id === 'left' || region.id === 'right') continue;
        const html = regionsMap.get(region.id);
        if (html) {
          otherRegionsHtml.push(html);
        }
      }
      regionsHtmlContent = renderElement(
        'div',
        { class: 'layout-root layout-vertical layout-two-column' },
        otherRegionsHtml.join('\n'),
      );
    } else if (layoutType === 'GRID') {
      const gridRegionsHtml: string[] = [];
      for (const region of layout.regions) {
        let html = regionsMap.get(region.id);
        if (html) {
          if (region.id.toLowerCase() === 'body') {
            html = renderElement('div', { class: 'uno-main' }, html);
          }
          gridRegionsHtml.push(html);
        }
      }
      regionsHtmlContent = renderElement(
        'div',
        { class: 'layout-root layout-vertical layout-grid' },
        gridRegionsHtml.join('\n'),
      );
    } else if (layoutType === 'SPLIT') {
      const splitIds = new Set(['left', 'right', 'top', 'bottom']);
      const splitRegionsHtml: string[] = [];
      for (const region of layout.regions) {
        if (splitIds.has(region.id)) {
          const html = regionsMap.get(region.id);
          if (html) {
            splitRegionsHtml.push(html);
          }
        }
      }
      let splitHtml = '';
      if (splitRegionsHtml.length > 0) {
        splitHtml = renderElement(
          'div',
          { class: 'layout-split' },
          splitRegionsHtml.join('\n'),
        );
      }
      const finalRegionsHtml: string[] = [];
      if (splitHtml) {
        finalRegionsHtml.push(splitHtml);
      }
      for (const region of layout.regions) {
        if (!splitIds.has(region.id)) {
          const html = regionsMap.get(region.id);
          if (html) {
            finalRegionsHtml.push(html);
          }
        }
      }
      regionsHtmlContent = renderElement(
        'div',
        { class: 'layout-root layout-vertical layout-split' },
        finalRegionsHtml.join('\n'),
      );
    } else if (layoutType === 'OVERLAY') {
      const overlayRegionsHtml: string[] = [];
      for (const region of layout.regions) {
        const html = regionsMap.get(region.id);
        if (html) {
          overlayRegionsHtml.push(html);
        }
      }
      regionsHtmlContent = renderElement(
        'div',
        { class: 'layout-root layout-vertical layout-overlay' },
        overlayRegionsHtml.join('\n'),
      );
    } else {
      // Default: VERTICAL
      regionsHtmlContent = renderElement(
        'div',
        { class: 'layout-root layout-vertical' },
        regionsList.join('\n'),
      );
    }

    const theme = getThemeForCard(card.cardIndex, context);

    const sheet = renderElement('div', { class: 'uno-sheet' }, regionsHtmlContent);
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

function humanize(text: string | undefined | null): string {
  return String(text || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function hashTopic(text: string): number {
  let out = 0;
  for (let i = 0; i < (text || '').length; i += 1) {
    out = (out * 31 + text.charCodeAt(i)) % 100000;
  }
  return out;
}

function getThemeForCard(
  cardIndex: number,
  context: FlashcardRenderContext,
): { frame: string; ink: string; tint: string; dash: string; bubble: string } {
  const template = context.template || {};
  const request = context.request || {};
  const hints = (template as any).renderingHints || {};
  const named = (hints.palette || hints.color || '').toLowerCase();
  const byName: Record<string, number> = {
    yellow: 0, sunshine: 0, gold: 0,
    pink: 1, magenta: 1,
    blue: 2, sky: 2, cyan: 2,
    red: 3, coral: 3,
    green: 4, mint: 4,
    purple: 5, violet: 5,
  };
  if (named && byName[named] !== undefined) {
    return THEMES[byName[named]];
  }
  const topic = (request as any).topic || '';
  const seed = hashTopic(topic) + cardIndex;
  return THEMES[seed % THEMES.length];
}

import { buildRegionLayout } from '../../utils/template-layout.util';
import { CardRenderer } from '../renderer/card.renderer';
import { ComponentRenderer } from '../renderer/component.renderer';
import { RegionRenderer } from '../renderer/region.renderer';

describe('CardRenderer', () => {
  const renderer = new CardRenderer(
    new RegionRenderer(new ComponentRenderer()),
  );

  it('renders regions and components in layout order without template-specific logic', () => {
    const html = renderer.render(
      {
        cardId: 'card-1',
        cardIndex: 1,
        components: [
          {
            componentId: 'img_main',
            type: 'image',
            componentType: 'image',
            editable: true,
            content: null,
            assetReference: {
              assetId: 'asset-1',
              s3ObjectKey: 'key',
              signedUrl: null,
              imageUrl: '/flashcards/assets/asset-1/image',
              caption: 'Apple',
              similarity: 0.9,
              mimeType: 'image/png',
              status: 'found',
              queryUsed: 'apple',
              attempts: [],
            },
          },
          {
            componentId: 'title_word',
            type: 'title',
            componentType: 'title',
            editable: true,
            content: 'Apple',
          },
        ],
      },
      buildRegionLayout({
        regions: [
          {
            id: 'body',
            components: [
              { id: 'img_main', type: 'image' },
              { id: 'title_word', type: 'title' },
            ],
          },
        ],
      }) as unknown as { regions: Array<{ id: string; components: Array<{ id: string; type: string }> }> },
      {
        apiBaseUrl: 'http://localhost:3000',
        pageWidth: 900,
        pageHeight: 1200,
        warnings: [],
      },
    );

    expect(html).toContain('data-region-id="body"');
    expect(html).toContain('data-component-id="img_main"');
    expect(html).toContain('data-component-id="title_word"');
    expect(html).toContain('class="u-caption"');
    expect(html).toContain('Apple');
  });

  it('skips null text content and still renders image placeholders', () => {
    const html = renderer.render(
      {
        cardId: 'card-2',
        cardIndex: 2,
        components: [
          {
            componentId: 'title_word',
            type: 'title',
            componentType: 'title',
            editable: true,
            content: null,
          },
        ],
      },
      buildRegionLayout({
        regions: [
          {
            id: 'body',
            components: [
              { id: 'img_main', type: 'image' },
              { id: 'title_word', type: 'title' },
            ],
          },
        ],
      }) as unknown as { regions: Array<{ id: string; components: Array<{ id: string; type: string }> }> },
      {
        apiBaseUrl: 'http://localhost:3000',
        pageWidth: 900,
        pageHeight: 1200,
        warnings: [],
      },
    );

    expect(html).toContain('Image unavailable');
    expect(html).not.toContain('class="u-caption"');
  });
});

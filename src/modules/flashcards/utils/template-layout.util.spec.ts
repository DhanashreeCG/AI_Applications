import {
  buildRegionLayout,
  listComponentOrderFromLayout,
  parseAgeGroupBounds,
  parseEditableComponentsFromLayout,
  parseLayoutDefinition,
} from './template-layout.util';
import { FlashcardException } from '../errors/flashcard.exception';

describe('template-layout.util', () => {
  const classificationLayout = {
    regions: [
      {
        id: 'body',
        components: [{ id: 'image', type: 'image', editable: true }],
      },
      {
        id: 'footer',
        components: [{ id: 'categories', type: 'chips', editable: true }],
      },
    ],
  };

  it('parses age group bounds from string bands', () => {
    expect(parseAgeGroupBounds(['3-4', '5-6'])).toEqual({ min: 3, max: 6 });
    expect(parseAgeGroupBounds(['8-14'])).toEqual({ min: 8, max: 14 });
    expect(parseAgeGroupBounds([])).toBeNull();
  });

  it('extracts editable components from region layout (no separate array)', () => {
    const editable = parseEditableComponentsFromLayout(classificationLayout);
    expect(editable).toEqual([
      expect.objectContaining({
        componentId: 'image',
        componentType: 'image',
        editable: true,
        regionId: 'body',
      }),
      expect.objectContaining({
        componentId: 'categories',
        componentType: 'chips',
        editable: true,
        regionId: 'footer',
      }),
    ]);
  });

  it('skips components marked editable: false', () => {
    const editable = parseEditableComponentsFromLayout({
      regions: [
        {
          id: 'body',
          components: [
            { id: 'image', type: 'image', editable: true },
            { id: 'frame', type: 'badge', editable: false },
          ],
        },
      ],
    });
    expect(editable.map((item) => item.componentId)).toEqual(['image']);
  });

  it('lists component order from regions', () => {
    expect(listComponentOrderFromLayout(classificationLayout)).toEqual([
      'image',
      'categories',
    ]);
  });

  it('rejects layouts without regions', () => {
    expect(() => parseLayoutDefinition({ root: 'card' })).toThrow(
      FlashcardException,
    );
  });

  it('builds a region layout', () => {
    expect(
      buildRegionLayout({
        regions: [
          {
            id: 'body',
            components: [{ id: 'image', type: 'image', editable: true }],
          },
        ],
      }),
    ).toEqual({
      regions: [
        {
          id: 'body',
          components: [{ id: 'image', type: 'image', editable: true }],
        },
      ],
    });
  });
});

import {
  buildLayoutDefinition,
  extractLayoutExtras,
  parseAgeGroupBounds,
} from './template-layout.util';

describe('template-layout.util', () => {
  it('parses age group bounds from string bands', () => {
    expect(parseAgeGroupBounds(['3-4', '5-6'])).toEqual({ min: 3, max: 6 });
    expect(parseAgeGroupBounds(['8-14'])).toEqual({ min: 8, max: 14 });
    expect(parseAgeGroupBounds([])).toBeNull();
  });

  it('extracts layout extras nested in layoutDefinition', () => {
    const extras = extractLayoutExtras({
      root: 'card',
      slots: [],
      editableComponents: [{ componentId: 'img_main', componentType: 'image' }],
      componentHierarchy: ['img_main'],
      renderingHints: { textScale: 'large' },
    });

    expect(extras.editableComponents).toEqual([
      { componentId: 'img_main', componentType: 'image' },
    ]);
    expect(extras.componentHierarchy).toEqual(['img_main']);
    expect(extras.renderingHints).toEqual({ textScale: 'large' });
  });

  it('builds a layoutDefinition with nested extras', () => {
    const layout = buildLayoutDefinition({
      root: 'card',
      slots: [{ componentId: 'img_main', role: 'hero-image' }],
      editableComponents: [],
      componentHierarchy: ['img_main'],
      renderingHints: { imageDominance: 'high' },
    });

    expect(layout).toEqual(
      expect.objectContaining({
        root: 'card',
        editableComponents: [],
        componentHierarchy: ['img_main'],
        renderingHints: { imageDominance: 'high' },
      }),
    );
  });
});

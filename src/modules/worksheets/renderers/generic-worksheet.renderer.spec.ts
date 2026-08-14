import { GenericWorksheetRenderer } from './generic-worksheet.renderer';
import { WorksheetRendererRegistry } from './worksheet-renderer.registry';

describe('GenericWorksheetRenderer', () => {
  const renderer = new GenericWorksheetRenderer();

  it('injects escaped text and iterates items', () => {
    const html = renderer.render({
      templateHtml:
        '<h1>{{instruction}}</h1>{{#items}}<p>{{@index}}. {{imageQuery}} x{{count}}</p><img src="{{assetUrl}}" />{{/items}}',
      structure: {
        instruction: 'Count <b>objects</b>.',
        items: [
          { count: 3, imageQuery: 'red apples', assetUrl: 'https://example/a' },
          { count: 5, imageQuery: 'bananas', assetUrl: 'https://example/b' },
        ],
      },
    });

    expect(html).toContain('Count &lt;b&gt;objects&lt;/b&gt;.');
    expect(html).toContain('1. red apples x3');
    expect(html).toContain('2. bananas x5');
    expect(html).toContain('src="https://example/a"');
  });
});

describe('WorksheetRendererRegistry', () => {
  it('resolves the generic renderer', () => {
    const registry = new WorksheetRendererRegistry(new GenericWorksheetRenderer());
    expect(registry.get('generic').type).toBe('generic');
  });

  it('rejects an unknown renderer type', () => {
    const registry = new WorksheetRendererRegistry(new GenericWorksheetRenderer());
    expect(() => registry.get('counting_objects')).toThrow(
      /No trusted renderer registered/,
    );
  });
});

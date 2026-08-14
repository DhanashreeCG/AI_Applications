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

  it('fills generic image slots from assetId-resolved URLs', () => {
    const html = renderer.render({
      templateHtml:
        '<img data-image-slot="main_image" />{{IMAGE:main_image}}',
      structure: {
        image: {
          id: 'main_image',
          imageQuery: 'two goats',
          assetId: 'asset-9',
          assetUrl: 'http://localhost:5000/worksheets/assets/asset-9/image',
        },
      },
      mode: 'export',
    });

    expect(html).toContain('data-image-slot="main_image"');
    expect(html).toContain('http://localhost:5000/worksheets/assets/asset-9/image');
    expect(html).not.toContain('{{IMAGE:main_image}}');
    expect(html).toContain('export-mode');
  });

  it('fills prototype-style numbered fields and named image tokens', () => {
    const html = renderer.render({
      templateHtml:
        '<div>{{TOPIC}}</div><div>{{INSTRUCTION_TEXT}}</div><div>{{QUESTION_1}}</div>{{GOAT_IMAGE}}',
      structure: {
        topic: 'Farm',
        instruction_text: 'Answer the questions.',
        questions: [{ question: 'What do goats eat?' }],
        image: {
          id: 'main_image',
          imageQuery: 'two goats',
          assetId: 'asset-9',
          assetUrl: '/worksheets/assets/asset-9/image',
        },
      },
      topic: 'Farm',
      mode: 'export',
    });

    expect(html).toContain('Farm');
    expect(html).toContain('Answer the questions.');
    expect(html).toContain('What do goats eat?');
    expect(html).toContain('/worksheets/assets/asset-9/image');
    expect(html).not.toContain('{{GOAT_IMAGE}}');
    expect(html).not.toContain('{{QUESTION_1}}');
  });

  it('fills the template background image URL', () => {
    const html = renderer.render({
      templateHtml: '<img class="worksheet-bg" src="{{BACKGROUND_IMAGE}}" />',
      structure: { topic: 'Farm' },
      backgroundAssetUrl: '/worksheets/assets/bg-1/image',
      mode: 'export',
    });
    expect(html).toContain('src="/worksheets/assets/bg-1/image"');
    expect(html).not.toContain('{{BACKGROUND_IMAGE}}');
  });

  it('keeps editor controls visible only in editor mode', () => {
    const editor = renderer.render({
      templateHtml: '<body><div data-editable="topic">{{topic}}</div></body>',
      structure: { topic: 'Farm' },
      mode: 'editor',
      canvas: { width: 1016, height: 1316 },
    });
    expect(editor).toContain('editor-mode');
    expect(editor).toContain('data-editor-bridge');
    expect(editor).toContain('1016px');

    const exported = renderer.render({
      templateHtml: '<body><div data-editable="topic">{{topic}}</div></body>',
      structure: { topic: 'Farm' },
      mode: 'export',
    });
    expect(exported).toContain('export-mode');
    expect(exported).not.toContain('data-editor-bridge');
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

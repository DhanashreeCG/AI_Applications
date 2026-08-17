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

  it('fills {{GOAT_IMAGE}} from structure.image.id and image_name without using GOAT as the slot id', () => {
    const html = renderer.render({
      templateHtml: '{{GOAT_IMAGE}}<div class="topic">{{TOPIC}}</div>',
      structure: {
        topic: 'Dolphin Fun',
        image: {
          id: 'main_image',
          image_name: 'cute jumping dolphins in the ocean',
          assetId: 'dolphin-1',
          assetUrl: '/worksheets/assets/dolphin-1/image',
        },
      },
      mode: 'export',
    });

    expect(html).toContain('Dolphin Fun');
    expect(html).toContain('data-image-slot="main_image"');
    expect(html).toContain('data-field-path="image"');
    expect(html).toContain('alt="cute jumping dolphins in the ocean"');
    expect(html).toContain('src="/worksheets/assets/dolphin-1/image"');
    expect(html).not.toContain('data-image-slot="GOAT"');
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

  it('does not emit /null resource URLs from empty FONT_PATH or pencil placeholders', () => {
    const html = renderer.render({
      templateHtml: `<!DOCTYPE html><html><head>
@font-face { font-family: 'Toondemy'; src: url('{{FONT_PATH}}') format('truetype'); }
</head><body>
<img class="worksheet-bg" src="{{BACKGROUND_IMAGE}}" />
<button class="ai-pencil"><img src="../../pencil.png" width="30" height="30"></button>
<img data-image-slot="main_image" src="null" />
</body></html>`,
      structure: { topic: 'Farm' },
      mode: 'editor',
      pencilIconUrl: '/pencil.png',
    });

    expect(html).not.toMatch(/src=["']null["']/i);
    expect(html).not.toMatch(/url\(\s*['"]?null['"]?\s*\)/i);
    expect(html).not.toContain('<base ');
    expect(html).toContain('src="/pencil.png"');
    expect(html).not.toContain('../../pencil.png');
    expect(html).not.toContain('@font-face');
  });

  it('restores SQL NULL placeholders from imported prototype templates', () => {
    const html = renderer.render({
      templateHtml: `<body class="NULL">
<img class="worksheet-bg" src="NULL" />
<div class="topic" data-editable="topic" > NULL </div>
<div class="badge" data-editable="badge_label" > NULL </div>
<div class="instruction" data-editable="instruction_text" > NULL </div>
NULL
<div class="question" data-editable="question_1" > NULL </div>
<div class="option" data-editable="option_1" > NULL </div>
<script>parent.window.selectedImageSide=null;</script>
</body>`,
      structure: {
        topic: 'Farm Animals',
        badge_label: 'Listen and Comprehend',
        instruction_text: 'Answer the questions and colour the goats.',
        questions: [
          { question: 'What do the goats eat?' },
          {
            question: 'Do you get angry?',
            options: [{ text: 'a. Share the toy.' }],
          },
        ],
        image: {
          id: 'main_image',
          imageQuery: 'two goats',
          assetId: 'asset-9',
          assetUrl: '/worksheets/assets/asset-9/image',
        },
      },
      backgroundAssetUrl: '/worksheets/assets/bg-1/image',
      topic: 'Farm Animals',
      mode: 'editor',
    });

    expect(html).toContain('Farm Animals');
    expect(html).toContain('Listen and Comprehend');
    expect(html).toContain('Answer the questions and colour the goats.');
    expect(html).toContain('What do the goats eat?');
    expect(html).toContain('a. Share the toy.');
    expect(html).toContain('/worksheets/assets/bg-1/image');
    expect(html).toContain('/worksheets/assets/asset-9/image');
    expect(html).toContain('selectedImageSide=null');
    expect(html).not.toMatch(/class="NULL"/);
    expect(html).not.toMatch(/>\s*NULL\s*</);
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

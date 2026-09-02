import { GenericWorksheetRenderer } from './generic-worksheet.renderer';
import { WorksheetRendererRegistry } from './worksheet-renderer.registry';
import { CircleTheThingsRenderer } from './circle-the-things.renderer';

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

  it('adds data-field-path even when the template image already has a src', () => {
    const html = renderer.render({
      templateHtml:
        '<img data-image-slot="main_image" src="/already.png" alt="goat" />',
      structure: {
        image: {
          id: 'main_image',
          imageQuery: 'two goats',
          assetId: 'asset-9',
          assetUrl: '/worksheets/assets/asset-9/image',
        },
      },
      mode: 'editor',
    });
    expect(html).toContain('src="/worksheets/assets/asset-9/image"');
    expect(html).not.toContain('src="/already.png"');
    expect(html).toContain('data-field-path="image"');
  });

  it('does not inject a second GOAT_IMAGE when the template already has the image box', () => {
    const html = renderer.render({
      templateHtml:
        '<img class="colour-box" data-image-slot="main_image" width="200" height="200" alt="" />{{GOAT_IMAGE}}',
      structure: {
        image: {
          id: 'main_image',
          imageQuery: 'vegetables',
          assetId: 'asset-9',
          assetUrl: '/worksheets/assets/asset-9/image',
        },
      },
    });
    expect(html).toContain('data-image-slot="main_image"');
    expect(html).toContain('src="/worksheets/assets/asset-9/image"');
    expect(html.match(/class="worksheet-image"/g) || []).toHaveLength(0);
    expect(html).not.toContain('left:70px;top:300px');
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
    expect(editor).toContain('body.editor-mode:not(.edit-mode) .ai-pencil');
    expect(editor).not.toMatch(/body\.editor-mode \[data-editable\] \{/);
    expect(editor).toContain('worksheet-set-image');
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
    expect(html).toContain('/fonts/TOONDEMY%20FONTS.TTF');
    expect(html).toContain("font-family:'Toondemy'");
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

  it('renders Handlebars {{#each pairs}} with number and name', () => {
    const html = renderer.render({
      templateHtml:
        '{{#each pairs}}<div class="number-item">{{number}}</div><div class="name-item">{{name}}</div>{{/each}}',
      structure: {
        pairs: [
          { number: 20, name: 'TWENTY', color: '#e85d04' },
          { number: 15, name: 'FIFTEEN', color: '#2a9d8f' },
        ],
      },
    });

    expect(html).toContain('TWENTY');
    expect(html).toContain('FIFTEEN');
    expect(html).toContain('>20<');
    expect(html).toContain('>15<');
    expect(html).not.toContain('{{#each pairs}}');
    expect(html).toContain('top:280px');
    expect(html).toContain('left:95px');
    expect(html).toContain('left:620px');
    expect(html).toContain('top:368px');
  });

  it('fills empty top/left styles so pair pills do not stack at 0,0', () => {
    const html = renderer.render({
      templateHtml:
        '{{#each pairs}}<div class="number-item" style="top: px; left: px;">{{number}}</div><div class="name-item" style="top: px; left: px; color: ;">{{name}}</div>{{/each}}',
      structure: {
        pairs: [
          { number: 20, name: 'TWENTY', color: '#e85d04' },
          { number: 15, name: 'FIFTEEN', color: '#2a9d8f' },
        ],
      },
    });

    expect(html).not.toMatch(/top:\s*px/);
    expect(html).toContain('top:280px');
    expect(html).toContain('left:620px');
    expect(html).toContain('color:#e85d04');
  });

  it('injects positioned pair rows when NUMBERS/NAMES tokens or empty each body are used', () => {
    const html = renderer.render({
      templateHtml: '{{NUMBERS}}{{NAMES}}',
      structure: {
        pairs: [{ number: 8, name: 'EIGHT', color: '#111111' }],
      },
    });

    expect(html).toContain('class="number-item"');
    expect(html).toContain('class="name-item"');
    expect(html).toContain('EIGHT');
    expect(html).toContain('data-field-path="pairs[0].number"');
    expect(html).toMatch(/style="top:\d+px;left:\d+px"/);
  });

  it('does not dump item JSON into the worksheet canvas', () => {
    const html = renderer.render({
      templateHtml:
        '<div class="activity-box">{{ITEMS}}</div>',
      structure: {
        worksheet_type: 'circle_the_things',
        items: [
          {
            id: 'i1',
            label: 'carrot',
            imageQuery: 'orange carrot',
            is_correct: true,
            assetUrl: '/worksheets/assets/a1/image',
          },
        ],
      },
    });

    expect(html).not.toContain('"imageQuery"');
    expect(html).not.toContain('[{');
    expect(html).toContain('class="item"');
    expect(html).toContain('carrot');
    expect(html).toContain('/worksheets/assets/a1/image');
    const tops = [...html.matchAll(/class="item"[^>]*top:(\d+)px/g)].map((m) => Number(m[1]));
    expect(tops.length).toBe(1);
    expect(Math.max(...tops) + 180).toBeLessThanOrEqual(760);
  });

  it('renders number_names pairs without using pastel colors as text', () => {
    const html = renderer.render({
      templateHtml: '<body>{{NUMBERS}}{{NAMES}}</body></html></body></html>',
      structure: {
        worksheet_type: 'number_names',
        pairs: [{ number: '20', name: 'twenty', color: '#f8c8d0' }],
      },
    });

    expect(html).toContain('>20<');
    expect(html).toContain('>twenty<');
    expect(html).toContain('font-size:28px');
    expect(html).not.toContain('color:#f8c8d0');
    expect(html).not.toContain('"pairs"');
    expect(html).toContain('</body></html>');
    expect(html).not.toMatch(/<\/body>\s*<\/html>\s*<\/body>/);
  });

  it('renders match-the-pairs images from {{PAIR_IMAGES}} without touching number-name pairs', () => {
    const html = renderer.render({
      templateHtml:
        '<div class="activity-box">{{PAIR_IMAGES}}</div>',
      structure: {
        worksheet_type: 'match_the_pairs',
        pairs: [
          {
            id: 'pair_1',
            label: 'eye',
            left_image: { imageQuery: 'eye', assetUrl: '/worksheets/assets/eye/image' },
            right_image: { imageQuery: 'eye', assetUrl: '/worksheets/assets/eye/image' },
          },
          {
            id: 'pair_2',
            label: 'ear',
            left_image: { imageQuery: 'ear', assetUrl: '/worksheets/assets/ear/image' },
            right_image: { imageQuery: 'ear', assetUrl: '/worksheets/assets/ear/image' },
          },
        ],
      },
    });

    expect(html).toContain('data-side="left"');
    expect(html).toContain('data-side="right"');
    expect(html).toContain('data-field-path="pairs[0].left_image"');
    expect(html).toContain('data-image-slot="pairs[0].left_image"');
    expect(html).toContain('data-image-slot="pairs[1].left_image"');
    expect(html).not.toMatch(/data-image-slot="left_image"/);
    expect(html).toContain('left:80px;top:330px');
    expect(html).toContain('left:790px');
    expect(html).toContain('/worksheets/assets/eye/image');
    expect(html).not.toContain('{{PAIR_IMAGES}}');
    expect(html).not.toContain('class="number-item"');
  });

  it('renders sight-word rows and word-bank tokens without dumping JSON', () => {
    const html = renderer.render({
      templateHtml:
        '<div class="word-bank">{{WORD_BANK_ITEMS}}</div>{{ROWS}}',
      structure: {
        worksheet_type: 'circle_the_words',
        sight_word_bank: ['in', 'she'],
        rows: [
          {
            id: 'row_1',
            sentence: 'The toys are in the box.',
            target_sight_word: 'in',
            imageQuery: 'toy box',
            assetUrl: '/worksheets/assets/toy/image',
          },
          {
            id: 'row_2',
            sentence: 'She has a doll.',
            target_sight_word: 'she',
            imageQuery: 'doll',
            assetUrl: '/worksheets/assets/doll/image',
          },
        ],
      },
      pencilIconUrl: '/pencil.png',
    });

    expect(html).toContain('data-editable="sight_word_0"');
    expect(html).toContain('>in<');
    expect(html).toContain('class="worksheet-row row-1"');
    expect(html).toContain('The toys are in the box.');
    expect(html).toContain('data-editable="sentence_1"');
    expect(html).toContain('data-field-path="rows[0].sentence"');
    expect(html).toContain('data-pencil-for="sentence_1"');
    expect(html).toContain('/worksheets/assets/toy/image');
    expect(html).not.toContain('{{ROWS}}');
    expect(html).not.toContain('{{WORD_BANK_ITEMS}}');
    expect(html).not.toContain('"target_sight_word"');
  });
});

describe('WorksheetRendererRegistry', () => {
  it('resolves the generic renderer', () => {
    const generic = new GenericWorksheetRenderer();
    const registry = new WorksheetRendererRegistry(generic, new CircleTheThingsRenderer(generic));
    expect(registry.get('generic').type).toBe('generic');
    expect(registry.get('generic', 'circle_the_things').type).toBe('circle_the_things');
    expect(registry.get('generic', 'number_names').type).toBe('generic');
  });

  it('rejects an unknown renderer type', () => {
    const generic = new GenericWorksheetRenderer();
    const registry = new WorksheetRendererRegistry(generic, new CircleTheThingsRenderer(generic));
    expect(() => registry.get('counting_objects')).toThrow(
      /No trusted renderer registered/,
    );
  });
});

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
    expect(html).not.toContain('item-label');
    expect(html).not.toMatch(/>\s*carrot\s*</);
    expect(html).toContain('alt="orange carrot"');
    expect(html).toContain('/worksheets/assets/a1/image');
    const tops = [...html.matchAll(/class="item"[^>]*top:(\d+)px/g)].map((m) => Number(m[1]));
    expect(tops.length).toBe(1);
    expect(Math.max(...tops) + 145).toBeLessThanOrEqual(760);
  });

  it('places circle_the_things items in a 2-3-2 grid without labels', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      id: `i${i + 1}`,
      label: `item${i + 1}`,
      imageQuery: `object ${i + 1}`,
      is_correct: i % 2 === 0,
      assetUrl: `/worksheets/assets/a${i + 1}/image`,
    }));
    const html = renderer.render({
      templateHtml: '<div class="activity-box">{{ITEMS}}</div>',
      structure: {
        worksheet_type: 'circle_the_things',
        items,
      },
    });

    expect(html).not.toContain('item-label');
    for (const item of items) {
      expect(html).not.toMatch(new RegExp(`>\\s*${item.label}\\s*<`));
    }

    const placed = [
      ...html.matchAll(/class="item"[^>]*top:(\d+)px;left:(\d+)px/g),
    ].map((m) => ({ top: Number(m[1]), left: Number(m[2]) }));
    expect(placed).toHaveLength(7);

    const minT = Math.min(...placed.map((p) => p.top));
    const maxT = Math.max(...placed.map((p) => p.top));
    const span = Math.max(1, maxT - minT);
    const band = (top: number) => {
      const t = (top - minT) / span;
      if (t < 0.33) return 0;
      if (t < 0.66) return 1;
      return 2;
    };
    expect(placed.filter((p) => band(p.top) === 0)).toHaveLength(2);
    expect(placed.filter((p) => band(p.top) === 1)).toHaveLength(3);
    expect(placed.filter((p) => band(p.top) === 2)).toHaveLength(2);
    // Staggered: not all items share the same top within a band.
    const topBandTops = placed.filter((p) => band(p.top) === 0).map((p) => p.top);
    expect(new Set(topBandTops).size).toBeGreaterThan(1);
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
    // Digits sit 8px below name-pill tops so they center in the circles.
    expect(html).toMatch(/class="number-item"[^>]*top:343px/);
    expect(html).toMatch(/class="name-item"[^>]*top:335px/);
  });

  it('fills matching_single_letter column letters and places the scene image in its zone', () => {
    const html = renderer.render({
      templateHtml: `
        <div class="col-letter" data-editable="left_letter_1">{{LEFT_1}}</div>
        <div class="col-letter" data-editable="right_letter_1">{{RIGHT_1}}</div>
        {{SCENE_IMAGE}}
        <div class="img-zone-box" onclick="selectWorksheetImage('scene_image')"
          style="left:300px;top:720px;width:430px;height:380px;"></div>
      `,
      structure: {
        worksheet_type: 'matching_single_letter',
        target_letter: 'A',
        left_letters: [{ id: 'left_1', letter: 'i', is_match: false }],
        right_letters: [{ id: 'right_1', letter: 'a', is_match: true }],
        image: {
          id: 'scene_image',
          imageQuery: 'ant and alligator',
          assetUrl: '/worksheets/assets/scene/image',
        },
      },
    });

    expect(html).toContain('>i<');
    expect(html).toContain('>a<');
    expect(html).not.toContain('{{LEFT_1}}');
    expect(html).not.toContain('{{SCENE_IMAGE}}');
    expect(html).toMatch(
      /data-image-slot="scene_image"[^>]*src="\/worksheets\/assets\/scene\/image"/,
    );
    expect(html).toMatch(/left:300px;top:720px;width:430px;height:380px/);
    expect(html).not.toMatch(/left:70px;top:300px/);
  });

  it('fills look_and_say_circle_the_letters read-aloud, circle box, and vocab highlights', () => {
    const html = renderer.render({
      templateHtml: `
        <div class="upper-letter">{{TARGET_LETTER_UPPER}}</div>
        <div class="lower-letter">{{TARGET_LETTER_LOWER}}</div>
        <div class="cl-letter" data-editable="cl_1">{{CL_1}}</div>
        <div class="cl-letter" data-editable="cl_2">{{CL_2}}</div>
        <div class="vocab-word" data-editable="word_1">{{WORD_1}}</div>
        {{IMAGE_1}}
        <div class="img-zone-box" onclick="selectWorksheetImage('item_1')"
          style="left:387px;top:715px;width:219px;height:155px;"></div>
      `,
      structure: {
        worksheet_type: 'look_and_say_circle_the_letters',
        target_letter: 'A',
        letter_upper: 'A',
        letter_lower: 'a',
        circle_letters: [
          { id: 'cl_1', letter: 'A', is_target: true },
          { id: 'cl_2', letter: 'b', is_target: false },
        ],
        items: [
          {
            id: 'item_1',
            word: 'ant',
            imageQuery: 'red ant',
            assetUrl: '/worksheets/assets/ant/image',
          },
        ],
      },
    });

    expect(html).toContain('>A<');
    expect(html).toContain('>a<');
    expect(html).toContain('>b<');
    expect(html).not.toContain('{{TARGET_LETTER_UPPER}}');
    expect(html).not.toContain('{{CL_1}}');
    expect(html).toContain('<span class="hl-letter">a</span>nt');
    expect(html).toMatch(/data-image-slot="item_1"[^>]*src="\/worksheets\/assets\/ant\/image"/);
    expect(html).toMatch(/left:387px;top:715px;width:219px;height:155px/);
  });

  it('places storytime_maze clipart at structure positions via ITEMS_HTML', () => {
    const html = renderer.render({
      templateHtml: '<body>{{ITEMS_HTML}}</body>',
      structure: {
        worksheet_type: 'storytime_maze',
        items: [
          {
            id: 'item_start',
            role: 'start_character',
            label: 'tortoise',
            imageQuery: 'green tortoise',
            assetUrl: '/worksheets/assets/tortoise/image',
            position: { top: 885, left: 35, width: 210, height: 150 },
          },
          {
            id: 'item_obstacle',
            role: 'story_element',
            label: 'hare under tree',
            imageQuery: 'hare sleeping under tree',
            assetUrl: '/worksheets/assets/hare/image',
            position: { top: 480, left: 550, width: 265, height: 275 },
          },
          {
            id: 'item_finish',
            role: 'goal',
            label: 'finish flag',
            imageQuery: 'red finish flag',
            assetUrl: '/worksheets/assets/flag/image',
            position: { top: 875, left: 835, width: 135, height: 160 },
          },
        ],
      },
    });

    expect(html).not.toContain('{{ITEMS_HTML}}');
    expect(html).toContain('data-image-slot="item_start"');
    expect(html).toContain('data-image-slot="item_obstacle"');
    expect(html).toContain('data-image-slot="item_finish"');
    expect(html).toMatch(/left:35px;top:910px;width:200px;height:140px/);
    expect(html).toMatch(/left:630px;top:560px;width:155px;height:155px/);
    expect(html).toMatch(/left:840px;top:905px;width:125px;height:145px/);
    expect(html).toContain('mix-blend-mode:multiply');
    expect(html).toContain('background:transparent');
    expect(html).toContain('/worksheets/assets/tortoise/image');
    expect(html).toContain('/worksheets/assets/hare/image');
    expect(html).toContain('/worksheets/assets/flag/image');
    expect(html).not.toContain('item-label');
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
    expect(html).toContain('data-pencil-for="rows[0].sentence"');
    expect(html).toContain('/worksheets/assets/toy/image');
    expect(html).not.toContain('{{ROWS}}');
    expect(html).not.toContain('{{WORD_BANK_ITEMS}}');
    expect(html).not.toContain('"target_sight_word"');
  });

  it('emits a syntactically valid editor bridge script', () => {
    const html = renderer.render({
      templateHtml: '<html><head></head><body><div data-editable="topic">x</div></body></html>',
      structure: { topic: 'Farm' },
      mode: 'editor',
    });

    const script = html.match(
      /<script data-editor-bridge="true">([\s\S]*?)<\/script>/,
    )?.[1];
    expect(script).toBeTruthy();
    // Regex literals lose their backslashes if the bridge template string is
    // not double-escaped, which throws at parse time and kills all editing.
    expect(() => new Function(script as string)).not.toThrow();
    expect(script).toContain("selectWorksheetImage\\(");
    expect(script).toContain('(\\d+)$');
  });

  it('places tracing pair images with big/small zone sizes', () => {
    const html = renderer.render({
      templateHtml: `
{{IMAGE_1_LEFT}}
<div class="img-zone-box" onclick="selectPairImage('pair_1', 'left')" style="left:205px;top:370px;width:95px;height:95px;"></div>
{{IMAGE_1_RIGHT}}
<div class="img-zone-box" onclick="selectPairImage('pair_1', 'right')" style="left:717px;top:370px;width:95px;height:95px;"></div>
{{IMAGE_2_LEFT}}
<div class="img-zone-box" onclick="selectPairImage('pair_2', 'left')" style="left:187px;top:520px;width:130px;height:130px;"></div>
{{IMAGE_2_RIGHT}}
<div class="img-zone-box" onclick="selectPairImage('pair_2', 'right')" style="left:699px;top:520px;width:130px;height:130px;"></div>
`,
      structure: {
        worksheet_type: 'tracing',
        topic: 'Big and small',
        pairs: [
          {
            id: 'pair_1',
            size: 'small',
            left_image: {
              imageQuery: 'small red bird',
              imageUrl: '/worksheets/assets/bird-s/image',
            },
            right_image: {
              imageQuery: 'small birdhouse',
              assetUrl: '/worksheets/assets/house-s/image',
            },
          },
          {
            id: 'pair_2',
            size: 'big',
            left_image: {
              imageQuery: 'big blue bird',
              imageUrl: '/worksheets/assets/bird-b/image',
            },
            right_image: {
              imageQuery: 'big birdhouse',
              imageUrl: '/worksheets/assets/house-b/image',
            },
          },
        ],
      },
      mode: 'export',
    });

    expect(html).toContain('src="/worksheets/assets/bird-s/image"');
    expect(html).toContain('src="/worksheets/assets/house-s/image"');
    expect(html).toContain('src="/worksheets/assets/bird-b/image"');
    expect(html).toContain('left:205px;top:370px;width:95px;height:95px');
    expect(html).toContain('left:187px;top:520px;width:130px;height:130px');
    expect(html).toContain('left:717px;top:370px;width:95px;height:95px');
    expect(html).toContain('left:699px;top:520px;width:130px;height:130px');
    expect(html).toContain('data-field-path="pairs[0].left_image"');
    expect(html).toContain('data-field-path="pairs[1].right_image"');
    expect(html).not.toContain('{{IMAGE_1_LEFT}}');
    expect(html).not.toContain('{{IMAGE_2_RIGHT}}');
  });

  it('places look-and-say quadrant images and highlights target letters', () => {
    const html = renderer.render({
      templateHtml: `
<style>
.caption { position:absolute; }
.caption-q1 { left:45px; top:508px; }
.worksheet-image { position:absolute; object-fit:contain; }
</style>
{{IMAGE_1}}
<div class="img-zone-box" onclick="selectWorksheetImage('item_1')" style="left:50px;top:260px;width:300px;height:230px;"></div>
<div class="caption caption-q1" data-editable="item_1">{{CAPTION_1}}</div>
{{IMAGE_2}}
<div class="img-zone-box" onclick="selectWorksheetImage('item_2')" style="left:540px;top:260px;width:400px;height:230px;"></div>
<div class="caption caption-q2" data-editable="item_2">{{CAPTION_2}}</div>
`,
      structure: {
        worksheet_type: 'look_and_say_letters_and_sounds',
        target_letter: 'C',
        letter_upper: 'C',
        letter_lower: 'c',
        items: [
          {
            id: 'item_1',
            letter: 'C',
            caption: 'C for Carrot',
            imageQuery: 'orange carrot vegetable',
            imageUrl: '/worksheets/assets/carrot/image',
          },
          {
            id: 'item_2',
            letter: 'c',
            caption: 'c for corn',
            imageQuery: 'yellow corn cob',
            assetUrl: '/worksheets/assets/corn/image',
          },
        ],
      },
      mode: 'export',
    });

    expect(html).toContain('src="/worksheets/assets/carrot/image"');
    expect(html).toContain('src="/worksheets/assets/corn/image"');
    expect(html).toContain('data-image-slot="item_1"');
    expect(html).toContain('data-image-slot="item_2"');
    expect(html).toContain('data-field-path="items[0]"');
    expect(html).toContain('data-field-path="items[0].caption"');
    expect(html).toContain('data-field-path="items[1]"');
    expect(html).toContain('left:50px;top:260px;width:300px;height:230px');
    expect(html).toContain('left:540px;top:260px;width:400px;height:230px');
    expect(html).toContain('z-index:2');
    expect(html).toContain('<span class="hl-letter">C</span> for <span class="hl-letter">C</span>arrot');
    expect(html).toContain('<span class="hl-letter">c</span> for <span class="hl-letter">c</span>orn');
    expect(html).not.toContain('{{IMAGE_1}}');
    expect(html).not.toContain('{{IMAGE_2}}');
    expect(html).not.toContain('left:70px;top:300px');
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

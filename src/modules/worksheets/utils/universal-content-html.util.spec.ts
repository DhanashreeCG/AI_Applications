import {
  buildUniversalSkeletonHtml,
  clampUniversalImageBoxes,
  ensureEditableLabels,
  fitUniversalContentLayout,
  isUniversalSlug,
  isUniversalStructure,
  normalizeImgTagsToImageTokens,
  normalizeUniversalStructure,
  resolveUniversalImageBoxBudget,
  sanitizeUniversalContentHtml,
  scrubShortPhrasePunctuation,
  softAlignImageQueries,
  UNIVERSAL_MAX_IMAGES,
} from './universal-content-html.util';

describe('universal strict dynamic HTML', () => {
  it('normalizes headers and images without imposing a layout catalog', () => {
    const next = normalizeUniversalStructure({
      topic: 'Animal Homes',
      sub_topic: 'Where do animals live?',
      instruction_text: 'Match each animal.',
      content_html: '<div>{{IMAGE_1}}{{IMAGE_2}}</div>',
      layout: 'match_grid',
      items: [{ title: 'x' }],
    });
    expect(next.main_topic).toBe('Animal Homes');
    expect(next.sub_topic).toBe('Practice');
    expect(next.layout).toBeUndefined();
    expect(next.items).toBeUndefined();
    expect((next.images as unknown[]).length).toBe(2);
    expect(next.worksheet_type).toBe('universal_template');
  });

  it('does not treat stray content_html as universal without worksheet_type', () => {
    expect(
      isUniversalStructure({
        content_html: '<div>hello</div>',
        topic: 'Other',
      }),
    ).toBe(false);
    expect(
      isUniversalStructure({
        worksheet_type: 'universal_template',
        content_html: '<div>hello</div>',
      }),
    ).toBe(true);
    expect(isUniversalSlug('universal_template')).toBe(true);
    expect(isUniversalSlug('match_the_pairs')).toBe(false);
  });

  it('converts img src="{{IMAGE_N}}" to bare tokens before sanitize', () => {
    const html = normalizeImgTagsToImageTokens(
      `<div><img src="{{IMAGE_1}}" alt="Bear" style="width:80px" /></div>`,
    );
    expect(html).toBe('<div>{{IMAGE_1}}</div>');
  });

  it('builds dynamic fragment with expanded image slots', () => {
    const html = buildUniversalSkeletonHtml({
      main_topic: 'Animal Homes',
      sub_topic: 'Science',
      instruction_text: 'Explore animal homes.',
      content_html:
        '<div style="display:flex;flex-direction:column;gap:16px;height:100%;">' +
        '<div style="display:flex;gap:12px;flex:1;">{{IMAGE_1}}<p>Bear cave</p></div>' +
        '<div style="display:flex;gap:12px;flex:1;"><img src="{{IMAGE_2}}" alt="Bird" /></div>' +
        '</div>',
      images: [
        { imageQuery: 'cartoon bear' },
        { imageQuery: 'cartoon bird nest' },
      ],
    });
    expect(html).toContain('class="ws-dynamic"');
    expect(html).toContain('data-image-slot="images[0]"');
    expect(html).toContain('data-image-slot="images[1]"');
    expect(html).toContain('aspect-ratio:1/1');
    expect(html).not.toContain('src="{{IMAGE');
    expect(html).not.toContain('ws-match');
    expect(html).not.toContain('layout-steps');
  });

  it('strips scripts from freeform HTML', () => {
    const html = sanitizeUniversalContentHtml(
      `<div onclick="x()"><p>Hi</p><script>evil()</script>{{IMAGE_1}}</div>`,
    );
    expect(html).toContain('<p>Hi</p>');
    expect(html).toContain('{{IMAGE_1}}');
    expect(html).not.toContain('script');
    expect(html).not.toContain('onclick');
  });

  it('unwraps height:100% root and tags bordered sections so last outline can close', () => {
    const fitted = fitUniversalContentLayout(
      `<div style="display:flex;flex-direction:column;gap:10px;height:100%;overflow:hidden;width:100%;">` +
        `<div style="border:3px solid #85cbf4;border-radius:14px;padding:10px;">Learn</div>` +
        `<div style="border:3px solid #67bd47;border-radius:14px;padding:10px;">Match</div>` +
        `<div style="border:3px solid #f03a3e;border-radius:14px;padding:10px;">Circle</div>` +
        `</div>`,
    );
    expect(fitted).not.toMatch(/height\s*:\s*100%/i);
    expect(fitted).toContain('ws-section');
    expect(fitted.match(/ws-section/g)?.length).toBe(3);
    expect(fitted).toMatch(/flex:1 1 0/);
    expect(fitted).toMatch(/min-height:0/);
    expect(fitted).toMatch(/box-sizing:border-box/);
  });

  it('keeps a complete border-bottom when only side borders are set', () => {
    const fitted = fitUniversalContentLayout(
      `<section style="border-top:3px solid #f03a3e;border-left:3px solid #f03a3e;border-right:3px solid #f03a3e;padding:8px;">Q</section>`,
    );
    expect(fitted).toMatch(/border-bottom:3px solid #f03a3e/i);
    expect(fitted).toContain('ws-section');
  });

  it('injects instruction without leaving a height:100% sibling stack', () => {
    const html = buildUniversalSkeletonHtml({
      main_topic: 'Animal Sounds',
      sub_topic: 'Listen',
      instruction_text: 'Match the animals to their sounds.',
      content_html:
        `<div style="height:100%;overflow:hidden;display:flex;flex-direction:column;">` +
        `<div style="border:2px solid #85cbf4;">A</div>` +
        `<div style="border:2px solid #f03a3e;">B</div>` +
        `</div>`,
      images: [{ imageQuery: 'cat' }, { imageQuery: 'dog' }],
    });
    expect(html).toContain('ws-instruction');
    expect(html).toContain('ws-section');
    expect(html).not.toMatch(/ws-section[^>]*height\s*:\s*100%/i);
    expect(html).not.toMatch(/ws-stack[^>]*height\s*:\s*100%/i);
    const withoutHost = html.replace(/<div class="ws-dynamic"[^>]*>/, '');
    expect(withoutHost).not.toMatch(/height\s*:\s*100%/i);
  });

  it('strips ! from short titles and keeps readable image boxes on sparse pages', () => {
    const next = normalizeUniversalStructure({
      main_topic: 'Fun Festivals!',
      sub_topic: 'Matching!',
      instruction_text: 'Look at the festivals and match the items.',
      labels: ['Kite!', 'Lamp'],
      content_html:
        `<div style="display:flex;flex-direction:column;">` +
        `<div style="border:2px solid #85cbf4;"><span data-editable="labels[0]" data-field-path="labels[0]">Kite!</span>` +
        `<div class="ws-img-box" style="width:60px;height:60px;">{{IMAGE_1}}</div></div>` +
        `<div style="border:2px solid #67bd47;"><span data-editable="labels[1]" data-field-path="labels[1]">Lamp</span>` +
        `<div class="ws-img-box" style="width:60px;height:60px;">{{IMAGE_2}}</div></div>` +
        `</div>`,
      images: [{ imageQuery: 'kite' }, { imageQuery: 'lamp' }],
    });
    expect(next.main_topic).toBe('Fun Festivals');
    expect(next.sub_topic).toBe('Matching');
    expect(next.labels).toEqual(['Kite', 'Lamp']);
    // Sparse (2 images) → boost tiny boxes to a readable size
    expect(String(next.content_html)).not.toMatch(/width:60px/);
    expect(String(next.content_html)).toMatch(/width:1[1-9]\dpx/);
    expect(String(next.content_html)).toContain('data-editable="labels[0]"');
  });

  it('scrubs ! from short HTML phrases but keeps sentence exclamations', () => {
    const html = scrubShortPhrasePunctuation(
      `<div><span>Hi!</span><p>Look at the fun festivals today!</p></div>`,
    );
    expect(html).toContain('>Hi<');
    expect(html).toContain('Look at the fun festivals today!');
  });

  it('auto-wraps short labels with data-editable when LLM omits spans', () => {
    const wrapped = ensureEditableLabels(
      `<div class="ws-section"><p>Kite Festival</p><div class="ws-img-box">{{IMAGE_1}}</div></div>`,
    );
    expect(wrapped).toContain('data-editable="labels[0]"');
    expect(wrapped).toContain('Kite Festival');
  });

  it('caps images at UNIVERSAL_MAX_IMAGES and drops higher tokens', () => {
    const tokens = Array.from(
      { length: UNIVERSAL_MAX_IMAGES + 3 },
      (_, i) => `{{IMAGE_${i + 1}}}`,
    ).join('');
    const next = normalizeUniversalStructure({
      main_topic: 'Many Pictures',
      sub_topic: 'Practice',
      instruction_text: 'Look at each picture carefully today.',
      content_html: `<div>${tokens}</div>`,
      images: Array.from({ length: UNIVERSAL_MAX_IMAGES + 3 }, (_, i) => ({
        imageQuery: `item ${i + 1}`,
      })),
    });
    expect((next.images as unknown[]).length).toBe(UNIVERSAL_MAX_IMAGES);
    expect(String(next.content_html)).not.toContain(
      `{{IMAGE_${UNIVERSAL_MAX_IMAGES + 1}}}`,
    );
    expect(String(next.content_html)).toContain(
      `{{IMAGE_${UNIVERSAL_MAX_IMAGES}}}`,
    );
  });

  it('soft-aligns imageQuery with a nearby single-token label', () => {
    const html =
      `<div><span data-editable="labels[0]" data-field-path="labels[0]">Kite</span>` +
      `<div class="ws-img-box">{{IMAGE_1}}</div></div>`;
    const aligned = softAlignImageQueries(
      html,
      [{ imageQuery: 'cute cartoon festival object' }],
      ['Kite'],
    );
    expect(String(aligned[0].imageQuery).toLowerCase()).toContain('kite');
  });

  it('boosts tiny image boxes on sparse pages and keeps dense pages compact', () => {
    const sparse = clampUniversalImageBoxes(
      `<div class="ws-section"><div class="ws-img-box" style="width:60px;height:60px;">{{IMAGE_1}}</div></div>` +
        `<div class="ws-section"><div class="ws-img-box" style="width:60px;height:60px;">{{IMAGE_2}}</div></div>`,
    );
    // 2 sections + 2 images (1 row each) → large target
    expect(sparse).toMatch(/width:1[4-9]\dpx/);

    const dense = clampUniversalImageBoxes(
      `<div class="ws-section">a</div><div class="ws-section">b</div><div class="ws-section">c</div>` +
        Array.from(
          { length: 8 },
          (_, i) =>
            `<div class="ws-img-box" style="width:180px;height:180px;">{{IMAGE_${i + 1}}}</div>`,
        ).join(''),
    );
    expect(dense).not.toMatch(/width:180px/);
  });

  it('sizes multi-row section images to fit section height (no bottom-row clip)', () => {
    const matchSection =
      `<div class="ws-section" style="border:2px solid #fecd59;">` +
      Array.from(
        { length: 4 },
        (_, i) =>
          `<div class="ws-img-box" style="width:180px;height:180px;">{{IMAGE_${i + 1}}}</div>`,
      ).join('') +
      `</div>`;
    const html = clampUniversalImageBoxes(
      `<div class="ws-section"><div class="ws-img-box" style="width:160px;height:160px;">{{IMAGE_5}}</div></div>` +
        matchSection,
      { viewportContentH: 1040 },
    );
    expect(html).not.toMatch(/width:180px/);
    // Pull widths only from the yellow match section (4 nested boxes).
    const matchHtml = html.match(
      /border:2px solid #fecd59[\s\S]*?<\/div>\s*(?=<div class="ws-section"|$)/i,
    )?.[0] ?? html.slice(html.indexOf('#fecd59'));
    const matchWidths = [
      ...matchHtml.matchAll(/ws-img-box[^>]*width:(\d+)px/gi),
    ].map((m) => Number(m[1]));
    expect(matchWidths.length).toBe(4);
    // Multi-row hard-cap is 140px so the 2nd row stays inside the section.
    expect(Math.max(...matchWidths)).toBeLessThanOrEqual(140);
  });

  it('enforces at most 2 activity sections for toddler normalize', () => {
    const next = normalizeUniversalStructure(
      {
        main_topic: 'Pets',
        sub_topic: 'Friends',
        instruction_text: 'Look at the pets and point to them.',
        content_html:
          `<div style="border:2px solid #85cbf4;padding:8px;">One {{IMAGE_1}}</div>` +
          `<div style="border:2px solid #fecd59;padding:8px;">Two {{IMAGE_2}}{{IMAGE_3}}</div>` +
          `<div style="border:2px solid #67bd47;padding:8px;">Three {{IMAGE_4}}</div>`,
        images: [
          { imageQuery: 'dog' },
          { imageQuery: 'cat' },
          { imageQuery: 'bird' },
          { imageQuery: 'fish' },
        ],
      },
      { ageGroup: '3-4', viewportContentH: 1104 },
    );
    const sections = String(next.content_html).match(/\bws-section\b/g) || [];
    expect(sections.length).toBeLessThanOrEqual(2);
    expect((next.images as unknown[]).length).toBeLessThanOrEqual(3);
  });

  it('resolves larger budgets for few images and smaller for dense pages', () => {
    expect(resolveUniversalImageBoxBudget(4, 2).targetPx).toBeGreaterThanOrEqual(
      150,
    );
    expect(resolveUniversalImageBoxBudget(7, 2).targetPx).toBeGreaterThanOrEqual(
      140,
    );
    expect(resolveUniversalImageBoxBudget(8, 3).maxPx).toBeLessThanOrEqual(96);
  });
});

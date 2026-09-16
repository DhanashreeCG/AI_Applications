import {
  applyUniversalDynamicLayout,
  buildUniversalActivitySignature,
  buildUniversalSkeletonHtml,
  clampUniversalImageBoxes,
  collapseDuplicateActivityHeadings,
  dedupeUniversalActivities,
  ensureEditableLabels,
  enforceUniversalActivitySectionLimit,
  fitUniversalContentLayout,
  inferUniversalActivityType,
  isUniversalSlug,
  isUniversalStructure,
  normalizeImgTagsToImageTokens,
  normalizeSemanticActivities,
  normalizeUniversalStructure,
  pruneEmptyUniversalActivitySections,
  resolveUniversalImageBoxBudget,
  resolveRespectedBoxTarget,
  scrubNestedCardGrowth,
  sanitizeUniversalContentHtml,
  scrubShortPhrasePunctuation,
  softAlignImageQueries,
  UNIVERSAL_MAX_IMAGES,
} from './universal-content-html.util';
import {
  allocateUniversalPageSpace,
  estimateActivityLayoutRequirement,
  resolveImageSizeTargets,
} from './universal-dynamic-layout.util';
import { validateUniversalLayout } from './universal-layout-validate.util';
import { resolveUniversalContentRoute } from './universal-content-ai.util';

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
    expect(html).not.toContain('layout-steps');
    expect(html).not.toMatch(/\bws-match\b(?!-)/);
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

  it('unwraps height:100% root and tags activities without equal-height flex', () => {
    const fitted = fitUniversalContentLayout(
      `<div style="display:flex;flex-direction:column;gap:10px;height:100%;overflow:hidden;width:100%;">` +
        `<div style="border:3px solid #85cbf4;border-radius:14px;padding:10px;">Learn</div>` +
        `<div style="border:3px solid #67bd47;border-radius:14px;padding:10px;">Match</div>` +
        `<div style="border:3px solid #f03a3e;border-radius:14px;padding:10px;">Circle</div>` +
        `</div>`,
    );
    expect(fitted).not.toMatch(/height\s*:\s*100%/i);
    expect(fitted).toContain('ws-activity');
    expect(fitted).toContain('ws-section');
    expect(fitted.match(/ws-activity/g)?.length).toBe(3);
    expect(fitted).toMatch(/flex:0 0 auto/);
    expect(fitted).not.toMatch(/flex:1 1 0/);
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
        `<div style="border:2px solid #85cbf4;">{{IMAGE_1}} A</div>` +
        `<div style="border:2px solid #f03a3e;">{{IMAGE_2}} B</div>` +
        `</div>`,
      images: [{ imageQuery: 'cat' }, { imageQuery: 'dog' }],
    });
    expect(html).toContain('ws-instruction');
    expect(html).toContain('ws-section');
    expect(html).not.toMatch(/ws-stack[^>]*\bheight\s*:\s*100%/i);
    // Section open tags must not fight the host with height:100% (img fill 100% is OK).
    const sectionOpens = html.match(/<(?:div|section)[^>]*\bws-section\b[^>]*>/gi) || [];
    for (const open of sectionOpens) {
      expect(open).not.toMatch(/(?:^|;)\s*height\s*:\s*100%/i);
    }
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
    // Sparse (2 images) → boost tiny boxes to a large visible size
    expect(String(next.content_html)).not.toMatch(/width:60px/);
    expect(String(next.content_html)).toMatch(/width:(?:1[4-9]\d|[23]\d{2})px/);
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

  it('boosts tiny image boxes using section space (not image-count crush)', () => {
    const sparse = clampUniversalImageBoxes(
      `<div class="ws-section"><div class="ws-img-box" style="width:60px;height:60px;">{{IMAGE_1}}</div></div>` +
        `<div class="ws-section"><div class="ws-img-box" style="width:60px;height:60px;">{{IMAGE_2}}</div></div>`,
      { viewportContentH: 1040 },
    );
    // Sparse sections → large recognizable boxes (adaptive, not global crush)
    expect(sparse).toMatch(/width:1[4-9]\dpx|width:2\d{2}px/);

    // Single-image activity can stay large while multi-image peer is sized independently
    const respected = clampUniversalImageBoxes(
      `<div class="ws-section">` +
        Array.from(
          { length: 4 },
          (_, i) =>
            `<div class="ws-img-box" style="width:140px;height:140px;">{{IMAGE_${i + 1}}}</div>`,
        ).join('') +
        `</div>` +
        `<div class="ws-section"><div class="ws-img-box" style="width:140px;height:140px;">{{IMAGE_5}}</div></div>`,
      { viewportContentH: 1104 },
    );
    const widths = [...respected.matchAll(/ws-img-box[^>]*width:(\d+)px/gi)].map(
      (m) => Number(m[1]),
    );
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(100);
    expect(Math.max(...widths)).toBeGreaterThanOrEqual(140);
  });

  it('sizes multi-row section images to fit section height (no bottom-row clip)', () => {
    const matchSection =
      `<div class="ws-section ws-match-area" style="border:2px solid #fecd59;">` +
      Array.from(
        { length: 4 },
        (_, i) =>
          `<div class="ws-match-row"><div class="ws-img-box" style="width:200px;height:200px;">{{IMAGE_${i + 1}}}</div></div>`,
      ).join('') +
      `</div>`;
    const html = clampUniversalImageBoxes(
      `<div class="ws-section"><div class="ws-img-box" style="width:160px;height:160px;">{{IMAGE_5}}</div></div>` +
        matchSection,
      { viewportContentH: 1040 },
    );
    const matchHtml =
      html.match(
        /border:2px solid #fecd59[\s\S]*?<\/div>\s*(?=<div class="ws-section"|$)/i,
      )?.[0] ?? html.slice(html.indexOf('#fecd59'));
    const matchWidths = [
      ...matchHtml.matchAll(/ws-img-box[^>]*width:(\d+)px/gi),
    ].map((m) => Number(m[1]));
    const primaryWidths = [
      ...html
        .slice(0, html.indexOf('#fecd59'))
        .matchAll(/ws-img-box[^>]*width:(\d+)px/gi),
    ].map((m) => Number(m[1]));
    expect(matchWidths.length).toBe(4);
    // Matching may shrink below recognition size — that is correct
    expect(Math.max(...matchWidths)).toBeLessThanOrEqual(200);
    expect(Math.min(...matchWidths)).toBeGreaterThanOrEqual(80);
    expect(new Set(matchWidths).size).toBe(1);
    if (primaryWidths.length) {
      expect(Math.min(...primaryWidths)).toBeGreaterThanOrEqual(
        Math.min(...matchWidths),
      );
    }
  });

  it('enforces exactly 1 activity section for age 2-3', () => {
    const next = normalizeUniversalStructure(
      {
        main_topic: 'Pets',
        sub_topic: 'Friends',
        instruction_text: 'Look at the pets.',
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
      { ageGroup: '2-3', viewportContentH: 1104 },
    );
    const html = String(next.content_html);
    const sections = html.match(/\bws-section\b/g) || [];
    expect(sections.length).toBe(1);
    // Keeps the richest section (2 images), remapped to IMAGE_1..2
    expect((next.images as unknown[]).length).toBe(2);
    expect(html).toMatch(/\{\{\s*IMAGE_1\s*\}\}/);
    expect(html).toMatch(/\{\{\s*IMAGE_2\s*\}\}/);
  });

  it('enforces at most 2 activity sections for age 3-4', () => {
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
    expect(sections.length).toBe(2);
    expect((next.images as unknown[]).length).toBeLessThanOrEqual(3);
  });

  it('caps activity sections at 4 for age 4-5+', () => {
    const content_html = Array.from({ length: 5 }, (_, i) => {
      const colors = ['#85cbf4', '#fecd59', '#67bd47', '#f03a3e', '#6d28d9'];
      return `<div style="border:2px solid ${colors[i]};padding:8px;">S${i + 1} {{IMAGE_${i + 1}}}</div>`;
    }).join('');
    const next = normalizeUniversalStructure(
      {
        main_topic: 'Pets',
        sub_topic: 'Practice',
        instruction_text: 'Complete the activities.',
        content_html,
        images: Array.from({ length: 5 }, (_, i) => ({
          imageQuery: `pet ${i + 1}`,
        })),
      },
      { ageGroup: '4-5', viewportContentH: 1104 },
    );
    const sections = String(next.content_html).match(/\bws-section\b/g) || [];
    expect(sections.length).toBeLessThanOrEqual(4);
    expect((next.images as unknown[]).length).toBeLessThanOrEqual(4);
  });

  it('drops empty first shells and keeps the picture section (age 2-3)', () => {
    const next = normalizeUniversalStructure(
      {
        main_topic: 'Sea Animals',
        sub_topic: 'Look and Point',
        instruction_text: 'Point to each sea animal.',
        content_html:
          `<div style="border:2px solid #fecd59;padding:12px;">` +
          `<div>1. Look and point</div>` +
          `<div>Point to each sea animal and say its name.</div>` +
          `</div>` +
          `<div style="border:2px solid #85cbf4;padding:12px;">` +
          `<div class="ws-img-box" style="width:140px;height:140px;">{{IMAGE_1}}</div>` +
          `<div class="ws-img-box" style="width:140px;height:140px;">{{IMAGE_2}}</div>` +
          `<div class="ws-img-box" style="width:140px;height:140px;">{{IMAGE_3}}</div>` +
          `<div class="ws-img-box" style="width:140px;height:140px;">{{IMAGE_4}}</div>` +
          `</div>`,
        images: [
          { imageQuery: 'fish' },
          { imageQuery: 'whale' },
          { imageQuery: 'dolphin' },
          { imageQuery: 'octopus' },
        ],
      },
      { ageGroup: '2-3', viewportContentH: 1104 },
    );
    const html = String(next.content_html);
    expect(html).toContain('{{IMAGE_1}}');
    expect(html).toContain('{{IMAGE_4}}');
    expect((next.images as unknown[]).length).toBe(4);
    const sections = html.match(/\bws-section\b/g) || [];
    expect(sections.length).toBe(1);
  });

  it('prefers image-rich sections when trimming age 3-4 to 2', () => {
    const next = normalizeUniversalStructure(
      {
        main_topic: 'Jungle',
        sub_topic: 'Match',
        instruction_text: 'Look and match.',
        content_html:
          `<div style="border:2px solid #85cbf4;padding:8px;"><span>1. Look and say</span><p>Point to each animal.</p></div>` +
          `<div style="border:2px solid #fecd59;padding:8px;">` +
          `{{IMAGE_1}}{{IMAGE_2}}{{IMAGE_3}}{{IMAGE_4}}</div>` +
          `<div style="border:2px solid #67bd47;padding:8px;">` +
          `{{IMAGE_5}}{{IMAGE_6}}</div>`,
        images: Array.from({ length: 6 }, (_, i) => ({
          imageQuery: `animal ${i + 1}`,
        })),
      },
      { ageGroup: '3-4', viewportContentH: 1104 },
    );
    const html = String(next.content_html);
    expect(html).not.toMatch(/Point to each animal/);
    expect(html).toContain('{{IMAGE_1}}');
    const activityCount = (html.match(/data-activity-id=/g) || []).length;
    expect(activityCount).toBe(2);
    expect((next.images as unknown[]).length).toBeGreaterThanOrEqual(4);
  });

  it('does not keep orphan images[] when HTML has no IMAGE tokens', () => {
    const next = normalizeUniversalStructure(
      {
        main_topic: 'Sea',
        sub_topic: 'Look',
        instruction_text: 'Point.',
        content_html:
          `<div style="border:2px solid #fecd59;padding:8px;">` +
          `<div>1. Look and point</div><p>Point to each sea animal and say its name.</p></div>`,
        images: [
          { imageQuery: 'fish' },
          { imageQuery: 'whale' },
        ],
      },
      { ageGroup: '2-3', viewportContentH: 1104 },
    );
    expect((next.images as unknown[]).length).toBe(0);
  });

  it('pruneEmptyUniversalActivitySections removes title-only shells', () => {
    const html =
      `<div class="ws-section" style="border:2px solid #ccc;">` +
      `<span>1. Look and say</span></div>` +
      `<div class="ws-section" style="border:2px solid #abc;">` +
      `<div class="ws-img-box">{{IMAGE_1}}</div></div>`;
    const pruned = pruneEmptyUniversalActivitySections(html);
    expect(pruned).not.toContain('Look and say');
    expect(pruned).toContain('{{IMAGE_1}}');
  });

  it('enforceUniversalActivitySectionLimit keeps richest sections', () => {
    const html =
      `<div class="ws-section" style="border:1px solid #000;">Empty title only here</div>` +
      `<div class="ws-section" style="border:1px solid #000;">{{IMAGE_1}}{{IMAGE_2}}</div>` +
      `<div class="ws-section" style="border:1px solid #000;">{{IMAGE_3}}</div>`;
    const next = enforceUniversalActivitySectionLimit(html, 1);
    expect(next).toContain('{{IMAGE_1}}');
    expect(next).not.toContain('{{IMAGE_3}}');
    expect(next).not.toContain('Empty title');
  });

  it('resolves adaptive budgets from section content (not image-count crush)', () => {
    const sparse = resolveUniversalImageBoxBudget(1, 1);
    const dense = resolveUniversalImageBoxBudget(6, 1);
    expect(sparse.targetPx).toBeGreaterThan(dense.targetPx);
    expect(sparse.minPx).toBeGreaterThanOrEqual(140);
    expect(dense.minPx).toBeGreaterThanOrEqual(72);
    expect(dense.targetPx).toBeGreaterThanOrEqual(80);
  });

  it('scrubNestedCardGrowth kills tall flex:1 wrappers so pictures can look large', () => {
    const html =
      `<div class="ws-section" style="border:2px solid #85cbf4;">` +
      `<div style="flex:1 1 0;height:100%;background:#fff;">` +
      `<div class="ws-img-box" style="width:160px;height:160px;">{{IMAGE_1}}</div>` +
      `<span>Octopus</span></div></div>`;
    const next = scrubNestedCardGrowth(html);
    expect(next).toMatch(/flex:0 0 auto/);
    expect(next).not.toMatch(/height:100%/);
    expect(next).toContain('ws-img-box');
  });

  it('buildUniversalSkeletonHtml injects image-layout CSS and hugs nested cards', () => {
    const html = buildUniversalSkeletonHtml(
      {
        worksheet_type: 'universal_template',
        instruction_text: 'Look and match.',
        content_html:
          `<div class="ws-section" style="border:2px solid #85cbf4;margin-top:-20px;">` +
          `<div style="flex:1;height:100%;background:#fff;">` +
          `<div class="ws-img-box" style="width:60px;height:60px;">{{IMAGE_1}}</div>` +
          `<span>Octopus</span></div></div>` +
          `<div class="ws-section" style="border:2px solid #b8e0b8;">` +
          `<div class="ws-img-box" style="width:60px;height:60px;">{{IMAGE_2}}</div></div>`,
        images: [{ imageQuery: 'octopus' }, { imageQuery: 'squid' }],
      },
      { ageGroup: '4-5', viewportContentH: 1104 },
    );
    expect(html).toContain('data-universal-img-layout');
    expect(html).toContain('width:100%!important');
    expect(html).not.toMatch(/margin-top:-20px/);
    // Nested picture cards hug content (activities use calculated heights, not flex:1).
    expect(html).toMatch(/background:#fff;[^"]*flex:0 0 auto|flex:0 0 auto;[^"]*background:#fff/);
    expect(html).not.toMatch(/background:#fff[^"]*height:100%/);
    expect(html).toMatch(/--activity-height:\d+px|height:\d+px/);
    expect(html).toMatch(/--image-size:\d+px|width:\d+px/);
    const widths = [...html.matchAll(/ws-img-box[^>]*width:(\d+)px/gi)].map((m) =>
      Number(m[1]),
    );
    expect(widths.every((w) => w >= 100)).toBe(true);
  });

  it('A: one activity with one large image gets a large recognizable box', () => {
    const next = normalizeUniversalStructure(
      {
        main_topic: 'Fox',
        sub_topic: 'Look',
        instruction_text: 'Look at the fox.',
        content_html:
          `<section class="ws-activity" data-activity-type="recognize" data-activity-id="a1" style="border:2px solid #85cbf4;">` +
          `<h3 class="ws-activity-title">1. Meet the Fox</h3>` +
          `<div class="ws-img-box" style="width:80px;height:80px;">{{IMAGE_1}}</div>` +
          `</section>`,
        images: [{ imageQuery: 'cartoon fox', role: 'primary', importance: 'high' }],
      },
      { ageGroup: '2-3', viewportContentH: 1104 },
    );
    const html = String(next.content_html);
    const widths = [...html.matchAll(/ws-img-box[^>]*width:(\d+)px/gi)].map((m) =>
      Number(m[1]),
    );
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(180);
    expect(html).toMatch(/data-activity-type="recognize"/);
  });

  it('B: image-heavy activity receives more height than text-heavy activity', () => {
    const html =
      `<section class="ws-activity" data-activity-type="recognize" data-activity-id="a1" style="border:2px solid #85cbf4;">` +
      `<div class="ws-img-box">{{IMAGE_1}}</div></section>` +
      `<section class="ws-activity" data-activity-type="trace" data-activity-id="a2" style="border:2px solid #fecd59;">` +
      `<span class="ws-trace-word" data-editable="labels[0]" data-field-path="labels[0]">FOX</span></section>`;
    const laid = applyUniversalDynamicLayout(html, {
      viewportContentH: 1104,
      hasInstruction: true,
    });
    const heights = [...laid.matchAll(/--activity-height:(\d+)px/gi)].map((m) =>
      Number(m[1]),
    );
    expect(heights.length).toBe(2);
    expect(heights[0]).toBeGreaterThan(heights[1]);
  });

  it('C: six-image matching stays readable and fits as a grid', () => {
    const boxes = Array.from(
      { length: 6 },
      (_, i) =>
        `<div class="ws-picture-card"><div class="ws-img-box" style="width:200px;height:200px;">{{IMAGE_${i + 1}}}</div></div>`,
    ).join('');
    const next = normalizeUniversalStructure(
      {
        main_topic: 'Fox',
        sub_topic: 'Match',
        instruction_text: 'Match the fox pictures.',
        content_html:
          `<section class="ws-activity" data-activity-type="match" data-activity-id="a1" style="border:2px solid #85cbf4;">` +
          `<div class="ws-match-area">${boxes}</div></section>`,
        images: Array.from({ length: 6 }, (_, i) => ({
          imageQuery: `fox ${i + 1}`,
          role: 'matching',
        })),
      },
      { ageGroup: '4-5', viewportContentH: 1104 },
    );
    const html = String(next.content_html);
    const widths = [...html.matchAll(/ws-img-box[^>]*width:(\d+)px/gi)].map((m) =>
      Number(m[1]),
    );
    expect(widths.length).toBe(6);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(100);
    expect(Math.max(...widths)).toBeLessThanOrEqual(200);
    expect(html).toMatch(/--activity-height:\d+px|height:\d+px/);
    expect(html).toContain('ws-match-row');
  });

  it('D: three activities get different heights (no equal-height forcing)', () => {
    const html =
      `<section class="ws-activity" data-activity-type="recognize" style="border:2px solid #85cbf4;">` +
      `<div class="ws-img-box">{{IMAGE_1}}</div></section>` +
      `<section class="ws-activity" data-activity-type="match" style="border:2px solid #fecd59;">` +
      `<div class="ws-img-box">{{IMAGE_2}}</div><div class="ws-img-box">{{IMAGE_3}}</div>` +
      `<div class="ws-img-box">{{IMAGE_4}}</div><div class="ws-img-box">{{IMAGE_5}}</div></section>` +
      `<section class="ws-activity" data-activity-type="trace" style="border:2px solid #67bd47;">` +
      `<span class="ws-trace-word">FOX</span></section>`;
    const laid = applyUniversalDynamicLayout(html, { viewportContentH: 1104 });
    const heights = [...laid.matchAll(/--activity-height:(\d+)px/gi)].map((m) =>
      Number(m[1]),
    );
    expect(heights.length).toBe(3);
    expect(new Set(heights).size).toBeGreaterThan(1);
    expect(laid).not.toMatch(/flex:1 1 0/);
  });

  it('E: duplicate activities are removed', () => {
    const html =
      `<section class="ws-activity" data-activity-type="circle" data-activity-id="a1" style="border:2px solid #85cbf4;">` +
      `<p>Circle the fox</p><div class="ws-img-box">{{IMAGE_1}}</div></section>` +
      `<section class="ws-activity" data-activity-type="circle" data-activity-id="a2" style="border:2px solid #fecd59;">` +
      `<p>Circle the fox</p><div class="ws-img-box">{{IMAGE_2}}</div></section>`;
    const deduped = dedupeUniversalActivities(normalizeSemanticActivities(html));
    expect(deduped.match(/data-activity-id=/g)?.length).toBe(1);
    expect(buildUniversalActivitySignature('circle', 'Circle the fox {{IMAGE_1}}')).toContain(
      'circle',
    );
  });

  it('F: empty activity sections are removed', () => {
    const next = normalizeUniversalStructure(
      {
        main_topic: 'Fox',
        sub_topic: 'Learn',
        instruction_text: 'Learn about foxes.',
        content_html:
          `<div style="border:2px solid #85cbf4;padding:12px;"><h3>1. Look</h3><p>Point to the fox.</p></div>` +
          `<div style="border:2px solid #fecd59;padding:12px;"><div class="ws-img-box">{{IMAGE_1}}</div></div>`,
        images: [{ imageQuery: 'fox' }],
      },
      { ageGroup: '4-5', viewportContentH: 1104 },
    );
    const html = String(next.content_html);
    expect(html).toContain('{{IMAGE_1}}');
    expect(html).not.toMatch(/Point to the fox/);
  });

  it('G: orphan image queries are removed', () => {
    const next = normalizeUniversalStructure(
      {
        main_topic: 'Fox',
        sub_topic: 'Look',
        instruction_text: 'Look.',
        content_html:
          `<section class="ws-activity" data-activity-type="recognize" style="border:2px solid #85cbf4;">` +
          `<div class="ws-img-box">{{IMAGE_1}}</div></section>`,
        images: [
          { imageQuery: 'fox' },
          { imageQuery: 'orphan wolf' },
          { imageQuery: 'orphan deer' },
        ],
      },
      { ageGroup: '2-3', viewportContentH: 1104 },
    );
    expect((next.images as unknown[]).length).toBe(1);
  });

  it('H: sparse content does not create giant blank equal-flex sections', () => {
    const html = buildUniversalSkeletonHtml(
      {
        worksheet_type: 'universal_template',
        instruction_text: 'Look at the fox.',
        content_html:
          `<section class="ws-activity" data-activity-type="recognize" style="border:2px solid #85cbf4;">` +
          `<div class="ws-img-box" style="width:60px;height:60px;">{{IMAGE_1}}</div></section>`,
        images: [{ imageQuery: 'fox' }],
      },
      { ageGroup: '2-3', viewportContentH: 1104 },
    );
    expect(html).toMatch(/flex:0 0 auto/);
    expect(html).not.toMatch(/\.ws-dynamic>\*:not\(\.ws-instruction\)\{[^}]*flex:1 1 0/);
    expect(html).toMatch(/--activity-height:\d+px|height:\d+px/);
  });

  it('I: dense content scales down within safe limits rather than equal crushing', () => {
    const boxes = Array.from(
      { length: 8 },
      (_, i) => `<div class="ws-img-box" style="width:220px;height:220px;">{{IMAGE_${i + 1}}}</div>`,
    ).join('');
    const req = estimateActivityLayoutRequirement({
      activityId: 'a1',
      activityType: 'match',
      imageCount: 8,
      pairCount: 4,
      hasMatch: true,
    });
    const plan = allocateUniversalPageSpace({
      requirements: [
        { ...req, activityId: 'a1' },
        { ...req, activityId: 'a2' },
        { ...req, activityId: 'a3' },
      ],
      viewportContentH: 1104,
    });
    const total = plan.allocations.reduce((a, x) => a + x.allocatedHeight, 0);
    expect(total).toBeLessThanOrEqual(plan.availableHeight + 2);
    expect(Math.min(...plan.allocations.map((a) => a.imageSize))).toBeGreaterThanOrEqual(
      40,
    );
    expect(plan.allocations.every((a) => a.pairCount === 4)).toBe(true);
    void boxes;
  });

  it('J/K/L age policies remain authoritative for activity caps', () => {
    const countActivities = (html: string) =>
      (html.match(/data-activity-id=/g) || []).length;

    const make = (ageGroup: string, count: number) =>
      normalizeUniversalStructure(
        {
          main_topic: 'Fox',
          sub_topic: 'Practice',
          instruction_text: 'Complete the activities.',
          content_html: Array.from({ length: count }, (_, i) => {
            return `<div style="border:2px solid #85cbf4;padding:8px;">S${i + 1} {{IMAGE_${i + 1}}}</div>`;
          }).join(''),
          images: Array.from({ length: count }, (_, i) => ({
            imageQuery: `fox ${i + 1}`,
          })),
        },
        { ageGroup, viewportContentH: 1104 },
      );

    expect(countActivities(String(make('2-3', 3).content_html))).toBe(1);
    expect(countActivities(String(make('3-4', 3).content_html))).toBe(2);
    expect(countActivities(String(make('4-5', 5).content_html))).toBeLessThanOrEqual(4);
  });

  it('M/N: layout pipeline is provider-independent (gemini vs openai route)', () => {
    const gemini = resolveUniversalContentRoute({
      envProvider: 'gemini',
      fallbackGeminiModel: 'gemini-2.5-flash',
    });
    const openai = resolveUniversalContentRoute({
      envProvider: 'openai',
      fallbackGeminiModel: 'gemini-2.5-flash',
      fallbackOpenaiModel: 'gpt-4.1-mini',
    });
    expect(gemini.provider).toBe('gemini');
    expect(openai.provider).toBe('openai');

    const structure = {
      main_topic: 'Fox',
      sub_topic: 'Learn',
      instruction_text: 'Learn about foxes today.',
      content_html:
        `<section class="ws-activity" data-activity-type="identify" style="border:2px solid #85cbf4;">` +
        `<div class="ws-img-box">{{IMAGE_1}}</div></section>` +
        `<section class="ws-activity" data-activity-type="trace" style="border:2px solid #fecd59;">` +
        `<span class="ws-trace-word">FOX</span></section>`,
      images: [{ imageQuery: 'fox' }],
    };
    const a = normalizeUniversalStructure(structure, {
      ageGroup: '4-5',
      viewportContentH: 1104,
    });
    const b = normalizeUniversalStructure(structure, {
      ageGroup: '4-5',
      viewportContentH: 1104,
    });
    expect(a.content_html).toBe(b.content_html);
    expect(String(a.content_html)).toMatch(/--activity-height|height:\d+px/);
  });

  it('validates layout diagnostics for empty + duplicate + orphan cases', () => {
    const html =
      `<section class="ws-activity" data-activity-type="circle" data-activity-id="a1">` +
      `<div class="ws-img-box" style="width:160px;height:160px;">{{IMAGE_1}}</div></section>` +
      `<section class="ws-activity" data-activity-type="circle" data-activity-id="a2">` +
      `<div class="ws-img-box" style="width:160px;height:160px;">{{IMAGE_1}}</div></section>` +
      `<section class="ws-activity" data-activity-id="a3"><p>Only title</p></section>`;
    const result = validateUniversalLayout({
      contentHtml: html,
      images: [{ imageQuery: 'fox' }, { imageQuery: 'orphan' }],
      viewportContentH: 1104,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.type === 'DUPLICATE_ACTIVITY')).toBe(true);
    expect(result.issues.some((i) => i.type === 'EMPTY_ACTIVITY')).toBe(true);
    expect(result.issues.some((i) => i.type === 'ORPHAN_IMAGE_QUERY')).toBe(true);
  });

  it('infers activity types and image size targets by content density', () => {
    expect(inferUniversalActivityType('<div class="ws-trace-word">FOX</div>')).toBe(
      'trace',
    );
    expect(inferUniversalActivityType('<div class="ws-match-area">{{IMAGE_1}}</div>')).toBe(
      'match',
    );
    expect(resolveImageSizeTargets(1, 'recognize').ideal).toBeGreaterThanOrEqual(220);
    expect(resolveImageSizeTargets(6, 'match').min).toBeGreaterThanOrEqual(80);
    expect(resolveImageSizeTargets(6, 'match').max).toBeLessThanOrEqual(150);
  });

  it('13: matching activity never drops required image slots when fitting', () => {
    const html =
      `<section class="ws-activity" data-activity-type="match" data-activity-id="a1" style="border:2px solid #85cbf4;">` +
      `<div class="ws-match-area">` +
      `<div class="ws-match-row"><div class="ws-img-box" style="width:200px;height:200px;">{{IMAGE_1}}</div><span>Fox</span></div>` +
      `<div class="ws-match-row"><div class="ws-img-box" style="width:200px;height:200px;">{{IMAGE_2}}</div><span>Cat</span></div>` +
      `</div></section>` +
      `<section class="ws-activity" data-activity-type="recognize" data-activity-id="a2" style="border:2px solid #fecd59;">` +
      `<div class="ws-img-box" style="width:220px;height:220px;">{{IMAGE_3}}</div></section>`;
    const laid = applyUniversalDynamicLayout(html, { viewportContentH: 900 });
    expect(laid).toContain('{{IMAGE_1}}');
    expect(laid).toContain('{{IMAGE_2}}');
    expect(laid).toContain('{{IMAGE_3}}');
    const matchPart = laid.slice(
      laid.indexOf('data-activity-id="a1"'),
      laid.indexOf('data-activity-id="a2"'),
    );
    const matchW = [...matchPart.matchAll(/ws-img-box[^>]*width:(\d+)px/gi)].map(
      (m) => Number(m[1]),
    );
    const primaryW = [
      ...laid
        .slice(laid.indexOf('data-activity-id="a2"'))
        .matchAll(/ws-img-box[^>]*width:(\d+)px/gi),
    ].map((m) => Number(m[1]));
    expect(matchW.length).toBe(2);
    expect(Math.min(...matchW)).toBeGreaterThanOrEqual(72);
    expect(Math.min(...primaryW)).toBeGreaterThan(Math.min(...matchW));
  });

  it('15/16: activities do not equal-flex and stay within viewport plan', () => {
    const reqs = [
      estimateActivityLayoutRequirement({
        activityId: 'a1',
        activityType: 'recognize',
        imageCount: 3,
        hasLabel: true,
      }),
      estimateActivityLayoutRequirement({
        activityId: 'a2',
        activityType: 'match',
        imageCount: 4,
        pairCount: 2,
        hasMatch: true,
        hasLabel: true,
      }),
      estimateActivityLayoutRequirement({
        activityId: 'a3',
        activityType: 'trace',
        imageCount: 0,
        hasTrace: true,
      }),
    ];
    const plan = allocateUniversalPageSpace({
      requirements: reqs,
      viewportContentH: 1104,
    });
    const heights = plan.allocations.map((a) => a.allocatedHeight);
    expect(new Set(heights).size).toBeGreaterThan(1);
    expect(plan.allocations[1].imageSize).toBeLessThan(
      plan.allocations[0].imageSize + 1,
    );
    const total =
      heights.reduce((s, h) => s + h, 0) +
      plan.interActivityGap * Math.max(0, heights.length - 1);
    expect(total).toBeLessThanOrEqual(plan.availableHeight + 80);
  });

  it('collapses duplicate activity title + instruction to one question', () => {
    const html =
      `<h3 class="ws-activity-title">1. Match Two Pairs</h3>` +
      `<p class="ws-activity-instruction">Match each animal to its word.</p>` +
      `<div class="ws-img-box">{{IMAGE_1}}</div>`;
    const next = collapseDuplicateActivityHeadings(html);
    expect(next).not.toContain('ws-activity-title');
    expect(next).toContain('Match each animal to its word.');
    expect(next).not.toContain('Match Two Pairs');
  });

  it('skeleton CSS does not clip activities with fixed height/overflow hidden', () => {
    const html = buildUniversalSkeletonHtml(
      {
        worksheet_type: 'universal_template',
        instruction_text: 'Point to the crab.',
        content_html:
          `<section class="ws-activity" data-activity-type="find" style="border:2px solid #85cbf4;">` +
          `<h3 class="ws-activity-title">Find the Crab</h3>` +
          `<p class="ws-activity-instruction">Point to the crab.</p>` +
          `<div class="ws-img-box" style="width:120px;height:120px;">{{IMAGE_1}}</div>` +
          `<span class="ws-label">Crab</span></section>`,
        images: [{ imageQuery: 'crab' }],
      },
      { ageGroup: '2-3', viewportContentH: 1104 },
    );
    expect(html).toContain('data-universal-img-layout');
    expect(html).toMatch(/overflow:visible!important/);
    expect(html).toMatch(/height:auto!important/);
    expect(html).toMatch(/\.ws-activity-title\{display:none/);
  });
});

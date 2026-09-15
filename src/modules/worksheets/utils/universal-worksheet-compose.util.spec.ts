import {
  applyAssetCompatibility,
  buildUniversalWorksheetModel,
  composeUniversalWorksheet,
  planUniversalComposition,
} from './universal-worksheet-compose.util';
import { isColoringCompatibleQuery } from './universal-worksheet.model';
import { validateUniversalLayout } from './universal-layout-validate.util';
import { resolveUniversalContentRoute } from './universal-content-ai.util';

describe('universal worksheet composition engine', () => {
  it('composes age 2–3 single rich activity from activities[]', () => {
    const result = composeUniversalWorksheet(
      {
        main_topic: 'Fox',
        sub_topic: 'Find',
        instruction_text: 'Find the fox.',
        activities: [
          {
            id: 'a1',
            type: 'find',
            title: 'Find the Fox',
            instruction: 'Point to the fox.',
            items: [
              { kind: 'image', imageIndex: 1, label: 'Fox', role: 'primary' },
              { kind: 'choice', imageIndex: 2, label: 'Cat' },
              { kind: 'choice', imageIndex: 3, label: 'Dog' },
            ],
            layoutIntent: {
              preferredLayout: 'choice-grid',
              density: 'spacious',
              imageImportance: 'high',
            },
          },
        ],
        images: [
          { imageQuery: 'cartoon fox' },
          { imageQuery: 'cartoon cat' },
          { imageQuery: 'cartoon dog' },
        ],
      },
      { ageGroup: '2-3', viewportContentH: 1104 },
    );
    expect(result.model.activities).toHaveLength(1);
    expect(result.model.activities[0].imageCount).toBeGreaterThanOrEqual(3);
    expect(result.content_html).toContain('ws-activity');
    expect(result.content_html).toContain('--activity-height');
    expect(result.content_html).toMatch(/width:(?:1[6-9]\d|2\d{2})px/);
    // Single toddler activity should claim substantial height (not a tiny strip)
    const h = Number(
      (result.content_html.match(/--activity-height:(\d+)px/) || [])[1] || 0,
    );
    expect(h).toBeGreaterThanOrEqual(280);
  });

  it('rejects tiny age 2–3 color-with-colored-asset by rewriting to find', () => {
    const model = buildUniversalWorksheetModel(
      {
        main_topic: 'Fox',
        sub_topic: 'Color',
        instruction_text: 'Color the fox.',
        activities: [
          {
            id: 'a1',
            type: 'color',
            title: 'Color the Fox',
            instruction: 'Color the fox.',
            items: [{ kind: 'image', imageIndex: 1, label: 'Fox' }],
          },
        ],
        images: [{ imageQuery: 'cute cartoon fox colorful' }],
      },
      { ageGroup: '2-3' },
    );
    expect(model.activities[0].type).toBe('find');
    expect(model.activities[0].title.toLowerCase()).not.toContain('color the');
    expect(isColoringCompatibleQuery('cute cartoon fox colorful')).toBe(false);
  });

  it('keeps color activity when outline query is present', () => {
    const model = applyAssetCompatibility(
      buildUniversalWorksheetModel(
        {
          main_topic: 'Fox',
          sub_topic: 'Color',
          instruction_text: 'Color the fox.',
          activities: [
            {
              id: 'a1',
              type: 'color',
              title: 'Color the Fox',
              instruction: 'Color the outline.',
              items: [{ kind: 'image', imageIndex: 1 }],
            },
          ],
          images: [
            { imageQuery: 'fox black and white outline line art for coloring' },
          ],
        },
        { ageGroup: '2-3' },
      ),
    );
    expect(model.activities[0].type).toBe('color');
  });

  it('emits aligned matching-columns layout', () => {
    const result = composeUniversalWorksheet(
      {
        main_topic: 'Sea',
        sub_topic: 'Match',
        instruction_text: 'Match the pairs.',
        activities: [
          {
            id: 'a1',
            type: 'match',
            title: 'Match Sea Animals',
            instruction: 'Draw a line to match.',
            leftItems: [
              { kind: 'pair-left', imageIndex: 1, label: 'Fish' },
              { kind: 'pair-left', imageIndex: 2, label: 'Whale' },
            ],
            rightItems: [
              { kind: 'pair-right', label: 'Fish' },
              { kind: 'pair-right', label: 'Whale' },
            ],
            layoutIntent: {
              preferredLayout: 'matching-columns',
              density: 'comfortable',
              imageImportance: 'normal',
            },
          },
        ],
        images: [{ imageQuery: 'fish' }, { imageQuery: 'whale' }],
      },
      { ageGroup: '3-4', viewportContentH: 1104 },
    );
    expect(result.content_html).toContain('ws-match-area');
    expect(result.content_html).toContain('ws-match-row');
    expect(result.content_html).toContain('ws-match-connector');
    const validation = validateUniversalLayout({
      contentHtml: result.content_html,
      images: result.images as unknown as Array<Record<string, unknown>>,
    });
    expect(
      validation.issues.some((i) => i.type === 'INVALID_MATCHING_LAYOUT'),
    ).toBe(false);
  });

  it('composes three distinct age 4–5 activities without equal heights', () => {
    const result = composeUniversalWorksheet(
      {
        main_topic: 'Friendly Foxes',
        sub_topic: 'Animals',
        instruction_text: 'Complete each fox activity.',
        activities: [
          {
            id: 'a1',
            type: 'find',
            title: 'Find the Fox',
            items: [
              { imageIndex: 1, label: 'Fox' },
              { imageIndex: 2, label: 'Cat' },
              { imageIndex: 3, label: 'Dog' },
            ],
            layoutIntent: { preferredLayout: 'choice-grid', density: 'comfortable', imageImportance: 'high' },
          },
          {
            id: 'a2',
            type: 'match',
            title: 'Match Fox Words',
            leftItems: [
              { imageIndex: 4, label: 'Fox' },
              { imageIndex: 5, label: 'Cub' },
            ],
            rightItems: [{ label: 'Fox' }, { label: 'Cub' }],
            layoutIntent: { preferredLayout: 'matching-columns', density: 'comfortable', imageImportance: 'normal' },
          },
          {
            id: 'a3',
            type: 'trace',
            title: 'Trace FOX',
            items: [{ kind: 'trace', label: 'FOX' }],
            layoutIntent: { preferredLayout: 'trace-row', density: 'comfortable', imageImportance: 'low' },
          },
        ],
        images: [
          { imageQuery: 'fox' },
          { imageQuery: 'cat' },
          { imageQuery: 'dog' },
          { imageQuery: 'fox side' },
          { imageQuery: 'fox cub' },
        ],
      },
      { ageGroup: '4-5', viewportContentH: 1104 },
    );
    expect(result.model.activities).toHaveLength(3);
    const heights = [...result.content_html.matchAll(/--activity-height:(\d+)px/g)].map(
      (m) => Number(m[1]),
    );
    expect(heights.length).toBe(3);
    expect(new Set(heights).size).toBeGreaterThan(1);
    expect(result.content_html).toContain('data-activity-type="find"');
    expect(result.content_html).toContain('ws-match-row');
    expect(result.content_html).toContain('ws-trace-word');
    const total = heights.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(result.plan.availableHeight + 40);
  });

  it('caps four activities and prefers stronger ones', () => {
    const activities = Array.from({ length: 5 }, (_, i) => ({
      id: `a${i + 1}`,
      type: i % 2 === 0 ? 'find' : 'circle',
      title: `Activity ${i + 1}`,
      items: [{ imageIndex: i + 1, label: `Item${i + 1}` }],
      layoutIntent: {
        preferredLayout: 'image-row',
        density: 'comfortable',
        imageImportance: 'normal',
      },
    }));
    const model = buildUniversalWorksheetModel(
      {
        main_topic: 'Animals',
        sub_topic: 'Practice',
        instruction_text: 'Do the activities.',
        activities,
        images: activities.map((_, i) => ({ imageQuery: `animal ${i + 1}` })),
      },
      { ageGroup: '4-5' },
    );
    expect(model.activities.length).toBeLessThanOrEqual(4);
  });

  it('plans larger images for one-image focus than six-image grids', () => {
    const one = planUniversalComposition(
      buildUniversalWorksheetModel({
        main_topic: 'Fox',
        sub_topic: 'Look',
        instruction_text: 'Look.',
        activities: [
          {
            id: 'a1',
            type: 'recognize',
            title: 'Meet the Fox',
            items: [{ imageIndex: 1 }],
            layoutIntent: {
              preferredLayout: 'large-picture',
              density: 'spacious',
              imageImportance: 'high',
            },
          },
        ],
        images: [{ imageQuery: 'fox' }],
      }),
    );
    const six = planUniversalComposition(
      buildUniversalWorksheetModel({
        main_topic: 'Fox',
        sub_topic: 'Match',
        instruction_text: 'Match.',
        activities: [
          {
            id: 'a1',
            type: 'match',
            title: 'Match',
            items: Array.from({ length: 6 }, (_, i) => ({ imageIndex: i + 1 })),
            layoutIntent: {
              preferredLayout: 'matching-grid',
              density: 'compact',
              imageImportance: 'normal',
            },
          },
        ],
        images: Array.from({ length: 6 }, (_, i) => ({
          imageQuery: `fox ${i + 1}`,
        })),
      }),
    );
    expect(one.allocations[0].imageSize).toBeGreaterThan(six.allocations[0].imageSize);
    expect(six.allocations[0].imageSize).toBeGreaterThanOrEqual(100);
  });

  it('is provider-independent for composition', () => {
    const gemini = resolveUniversalContentRoute({
      envProvider: 'gemini',
      fallbackGeminiModel: 'gemini-2.5-flash',
    });
    const openai = resolveUniversalContentRoute({
      envProvider: 'openai',
      fallbackGeminiModel: 'gemini-2.5-flash',
      fallbackOpenaiModel: 'gpt-4.1-mini',
    });
    expect(gemini.provider).not.toBe(openai.provider);
    const structure = {
      main_topic: 'Fox',
      sub_topic: 'Learn',
      instruction_text: 'Learn about foxes.',
      activities: [
        {
          id: 'a1',
          type: 'identify',
          title: 'See the Fox',
          items: [{ imageIndex: 1, label: 'Fox' }],
        },
      ],
      images: [{ imageQuery: 'fox' }],
    };
    const a = composeUniversalWorksheet(structure, { ageGroup: '4-5' });
    const b = composeUniversalWorksheet(structure, { ageGroup: '4-5' });
    expect(a.content_html).toBe(b.content_html);
  });

  it('Friendly Foxes regression: Match the Pairs keeps every required image', () => {
    const result = composeUniversalWorksheet(
      {
        main_topic: 'Friendly Foxes',
        sub_topic: 'Animals',
        instruction_text: 'Look, match, and learn.',
        activities: [
          {
            id: 'find',
            type: 'find',
            title: 'Find the Fox',
            instruction: 'Point to the fox.',
            items: [
              { imageIndex: 1, label: 'Fox' },
              { imageIndex: 2, label: 'Cat' },
              { imageIndex: 3, label: 'Dog' },
            ],
            layoutIntent: {
              preferredLayout: 'choice-grid',
              density: 'comfortable',
              imageImportance: 'high',
            },
          },
          {
            id: 'match',
            type: 'match',
            title: 'Match the Pairs',
            instruction: 'Draw a line to match.',
            leftItems: [
              { kind: 'pair-left', imageIndex: 4, label: 'Fox' },
              { kind: 'pair-left', imageIndex: 5, label: 'Cat' },
            ],
            rightItems: [
              { kind: 'pair-right', label: 'Fox' },
              { kind: 'pair-right', label: 'Cat' },
            ],
            layoutIntent: {
              preferredLayout: 'matching-columns',
              density: 'comfortable',
              imageImportance: 'normal',
            },
          },
        ],
        images: [
          { imageQuery: 'fox' },
          { imageQuery: 'cat' },
          { imageQuery: 'dog' },
          { imageQuery: 'fox match' },
          { imageQuery: 'cat match' },
        ],
      },
      { ageGroup: '3-4', viewportContentH: 1104 },
    );

    expect(result.content_html).toContain('{{IMAGE_4}}');
    expect(result.content_html).toContain('{{IMAGE_5}}');
    const matchRows = result.content_html.match(/ws-match-row/g) || [];
    expect(matchRows.length).toBe(2);
    const matchAlloc = result.plan.allocations.find((a) => a.activityId === 'match');
    const findAlloc = result.plan.allocations.find((a) => a.activityId === 'find');
    expect(matchAlloc?.pairCount).toBe(2);
    expect(matchAlloc?.imageSize).toBeGreaterThanOrEqual(80);
    expect(findAlloc?.imageSize).toBeGreaterThan(matchAlloc!.imageSize);
    expect(result.content_html).toMatch(/overflow:visible/);
    expect(result.content_html).toContain('ws-picture-card');
    expect(result.content_html).toContain('ws-card-label');
    // Exactly one question; no catalog section title
    expect(result.content_html).toContain('data-ws-role="question"');
    expect(result.content_html).not.toContain('ws-activity-title');
    expect(result.content_html).not.toMatch(/Find the Fox/);
    expect(result.content_html).toMatch(/Point to the fox|Draw a line to match/i);
  });

  it('matching 2/4/6 pairs always allocate one row per pair', () => {
    for (const pairs of [2, 4, 6]) {
      const result = composeUniversalWorksheet(
        {
          main_topic: 'Animals',
          sub_topic: 'Match',
          instruction_text: 'Match the pairs.',
          activities: [
            {
              id: 'm',
              type: 'match',
              title: 'Match the Pairs',
              leftItems: Array.from({ length: pairs }, (_, i) => ({
                kind: 'pair-left',
                imageIndex: i + 1,
                label: `L${i + 1}`,
              })),
              rightItems: Array.from({ length: pairs }, (_, i) => ({
                kind: 'pair-right',
                label: `R${i + 1}`,
              })),
              layoutIntent: {
                preferredLayout: 'matching-columns',
                density: 'compact',
                imageImportance: 'normal',
              },
            },
          ],
          images: Array.from({ length: pairs }, (_, i) => ({
            imageQuery: `animal ${i + 1}`,
          })),
        },
        { ageGroup: '4-5', viewportContentH: 1104 },
      );
      expect(result.content_html.match(/ws-match-row/g)?.length).toBe(pairs);
      for (let i = 1; i <= pairs; i += 1) {
        expect(result.content_html).toContain(`{{IMAGE_${i}}}`);
      }
      expect(result.plan.allocations[0].imageSize).toBeGreaterThanOrEqual(72);
      expect(result.plan.allocations[0].contentHeight).toBeLessThanOrEqual(
        result.plan.availableHeight + 20,
      );
    }
  });

  it('emits exactly one question and never a section title', () => {
    const result = composeUniversalWorksheet(
      {
        main_topic: 'Sea Animals',
        sub_topic: 'Look',
        instruction_text: 'Look at the sea animals.',
        activities: [
          {
            id: 'a1',
            type: 'find',
            title: '1. Find the Crab',
            instruction: 'Point to the crab.',
            items: [
              { imageIndex: 1, label: 'Crab' },
              { imageIndex: 2, label: 'Whale' },
              { imageIndex: 3, label: 'Turtle' },
              { imageIndex: 4, label: 'Octopus' },
              { imageIndex: 5, label: 'Fish' },
            ],
            layoutIntent: {
              preferredLayout: 'choice-grid',
              density: 'spacious',
              imageImportance: 'high',
            },
          },
        ],
        images: [1, 2, 3, 4, 5].map((n) => ({ imageQuery: `sea ${n}` })),
      },
      { ageGroup: '2-3', viewportContentH: 1104 },
    );
    expect(result.content_html).toContain('Point to the crab.');
    expect(result.content_html).not.toContain('Find the Crab');
    expect(result.content_html).not.toContain('ws-activity-title');
    expect(
      (result.content_html.match(/ws-activity-instruction/g) || []).length,
    ).toBe(1);
    expect(result.content_html.match(/\{\{IMAGE_\d+\}\}/g)?.length).toBe(5);
    // Single activity should absorb meaningful page height (not float tiny)
    expect(result.plan.allocations[0].allocatedHeight).toBeGreaterThan(350);
  });

  it('grid of 3 vs 6 chooses different image sizes', () => {
    const three = composeUniversalWorksheet(
      {
        main_topic: 'Sea',
        instruction_text: 'Point.',
        activities: [
          {
            id: 'g3',
            type: 'identify',
            items: [1, 2, 3].map((n) => ({ imageIndex: n, label: `A${n}` })),
            layoutIntent: {
              preferredLayout: 'choice-grid',
              density: 'comfortable',
              imageImportance: 'high',
            },
          },
        ],
        images: [1, 2, 3].map((n) => ({ imageQuery: `sea ${n}` })),
      },
      { ageGroup: '2-3', viewportContentH: 1104 },
    );
    const six = composeUniversalWorksheet(
      {
        main_topic: 'Sea',
        instruction_text: 'Point.',
        activities: [
          {
            id: 'g6',
            type: 'identify',
            items: [1, 2, 3, 4, 5, 6].map((n) => ({
              imageIndex: n,
              label: `A${n}`,
            })),
            layoutIntent: {
              preferredLayout: 'choice-grid',
              density: 'comfortable',
              imageImportance: 'normal',
            },
          },
        ],
        images: [1, 2, 3, 4, 5, 6].map((n) => ({ imageQuery: `sea ${n}` })),
      },
      { ageGroup: '4-5', viewportContentH: 1104 },
    );
    expect(three.plan.allocations[0].imageSize).toBeGreaterThan(
      six.plan.allocations[0].imageSize,
    );
    expect(six.content_html.match(/\{\{IMAGE_\d+\}\}/g)?.length).toBe(6);
  });
});

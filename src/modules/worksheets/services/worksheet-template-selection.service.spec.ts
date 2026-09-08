import { WorksheetTemplateSelectionService } from './worksheet-template-selection.service';
import { WorksheetTemplateSelectionAiService } from './worksheet-template-selection-ai.service';
import { WorksheetTemplateService } from './worksheet-template.service';
import { WorksheetTemplateRecord } from './worksheet-template.service';
import { WorksheetTemplateIntentClassification } from '../interfaces/worksheet-template-selection-ai.interfaces';
import { TEMPLATE_SELECTION_MIN_SCORE_MARGIN } from '../constants/worksheet-template-taxonomy.constants';

function template(
  overrides: Partial<WorksheetTemplateRecord> & { meta?: unknown } = {},
): WorksheetTemplateRecord {
  return {
    id: overrides.id ?? 'tmpl-1',
    name: overrides.name ?? 'Counting Objects',
    slug: overrides.slug ?? 'counting_objects_v1',
    category: overrides.category ?? 'numeracy',
    description: null,
    status: overrides.status ?? 'ACTIVE',
    version: 1,
    templateHtml: '<html></html>',
    structureDefinition: {},
    meta: overrides.meta ?? {
      grades: ['LKG', 'UKG'],
      subjects: ['Math'],
      topics: ['Counting'],
      theme: 'Maths — Core',
      subTopics: ['Numbers 1–10'],
      activityType: ['Count & Circle'],
      ageMin: 3,
      ageMax: 6,
      difficulty: ['easy', 'medium'],
    },
    rendererType: 'generic',
    rendererConfig: null,
    aiConfig: null,
    fieldPrompts: null,
    aiSystemPrompt: null,
    aiEditConfigJs: null,
    aiEditPopupHtml: null,
    aiEditPanelJs: null,
    editorJs: null,
    fieldEditorJs: null,
    rendererJs: null,
    backgroundAssetId: null,
    sampleAssetId: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: overrides.updatedAt ?? new Date('2024-06-01'),
    selectionProfile: overrides.selectionProfile ?? null,
  } as WorksheetTemplateRecord;
}

describe('WorksheetTemplateSelectionService (three-stage)', () => {
  const templateService = {
    getActiveByIdOrSlug: jest.fn(),
    listActive: jest.fn(),
    parseMeta: (row: WorksheetTemplateRecord) =>
      (row.meta ?? {}) as Record<string, unknown>,
  };

  const aiService = {
    select: jest.fn().mockResolvedValue({ result: null, usedFallback: true, fallbackReason: 'disabled' }),
    classify: jest.fn().mockResolvedValue({
      theme: 'Maths — Core',
      subTopic: 'Numbers 1–10',
      activityIntent: 'Count & Circle',
      difficulty: 'easy',
      confidence: 0.9,
    } satisfies WorksheetTemplateIntentClassification),
  };

  let service: WorksheetTemplateSelectionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WorksheetTemplateSelectionService(
      templateService as unknown as WorksheetTemplateService,
      aiService as unknown as WorksheetTemplateSelectionAiService,
    );
  });

  describe('Path A — explicit templateId', () => {
    it('selects without listing, filtering, or AI', async () => {
      const explicit = template({ id: 'explicit', slug: 'explicit_v1' });
      templateService.getActiveByIdOrSlug.mockResolvedValue(explicit);

      const selected = await service.select({ templateId: 'explicit_v1' });
      expect(selected.id).toBe('explicit');
      expect(templateService.listActive).not.toHaveBeenCalled();
      expect(aiService.classify).not.toHaveBeenCalled();
      expect(aiService.select).not.toHaveBeenCalled();
      expect((selected as any)._selectionTelemetry.selectionMode).toBe('explicit');
    });
  });

  describe('Stage 1 — age hard filter', () => {
    it('keeps templates whose band contains a point age', async () => {
      const inBand = template({ id: 'in', slug: 'in', meta: { ageMin: 4, ageMax: 5 } });
      const outBand = template({ id: 'out', slug: 'out', meta: { ageMin: 2, ageMax: 3 } });
      templateService.listActive.mockResolvedValue([outBand, inBand]);

      const selected = await service.select({ age: 4, query: 'count apples' });
      expect(selected.id).toBe('in');
      expect(aiService.classify).not.toHaveBeenCalled(); // single_age_match
    });

    it('uses ageGroup range overlap (not first-digit truncation)', async () => {
      // Old bug: "4-5" → age 4 only, so a template built for age 5 was wrongly excluded.
      const ageFive = template({
        id: 'age-five',
        slug: 'age_five',
        meta: { ageMin: 5, ageMax: 5, subjects: ['Math'] },
      });
      const ageThree = template({
        id: 'age-three',
        slug: 'age_three',
        meta: { ageMin: 3, ageMax: 3, subjects: ['Math'] },
      });
      templateService.listActive.mockResolvedValue([ageThree, ageFive]);

      const selected = await service.select({
        ageGroup: '4-5',
        query: 'numbers',
      });
      expect(selected.id).toBe('age-five');
      expect(aiService.classify).not.toHaveBeenCalled();
    });

    it('excludes templates missing age meta from auto-select', async () => {
      const missingAge = template({
        id: 'no-age',
        slug: 'no_age',
        meta: { grades: ['LKG'], subjects: ['Math'], topics: ['Counting'] },
      });
      const withAge = template({
        id: 'with-age',
        slug: 'with_age',
        meta: { ageMin: 3, ageMax: 4, subjects: ['Math'] },
      });
      templateService.listActive.mockResolvedValue([missingAge, withAge]);

      const selected = await service.select({ grade: 'LKG', query: 'count' });
      expect(selected.id).toBe('with-age');
    });

    it('still resolves missing-age templates via explicit templateId', async () => {
      const missingAge = template({
        id: 'no-age',
        slug: 'no_age',
        meta: { grades: ['LKG'] },
      });
      templateService.getActiveByIdOrSlug.mockResolvedValue(missingAge);

      const selected = await service.select({ templateId: 'no_age' });
      expect(selected.id).toBe('no-age');
    });

    it('throws NO_TEMPLATE_FOUND when age filter empties the pool', async () => {
      templateService.listActive.mockResolvedValue([
        template({ meta: { ageMin: 2, ageMax: 3 } }),
      ]);

      await expect(
        service.select({ age: 8, query: 'algebra' }),
      ).rejects.toMatchObject({
        code: 'NO_TEMPLATE_FOUND',
        details: expect.objectContaining({
          ageBand: { min: 8, max: 8 },
        }),
      });
    });
  });

  describe('Stage 2 / 3 — rerank + select', () => {
    const farmMatch = template({
      id: 'farm-match',
      slug: 'farm_match',
      updatedAt: new Date('2024-01-01'),
      meta: {
        ageMin: 3,
        ageMax: 4,
        theme: 'Farm to Fork',
        subTopics: ['Table Manners'],
        activityType: ['Match the Pairs'],
        difficulty: ['easy'],
        subjects: ['EVS'],
        grades: ['LKG'],
      },
    });
    const genericCount = template({
      id: 'generic-count',
      slug: 'generic_count',
      updatedAt: new Date('2024-06-01'),
      meta: {
        ageMin: 3,
        ageMax: 4,
        subjects: ['Math'],
        difficulty: ['medium'],
      },
    });

    it('short-circuits without Stage 3 LLM when rerank margin is decisive', async () => {
      templateService.listActive.mockResolvedValue([genericCount, farmMatch]);
      aiService.classify.mockResolvedValue({
        theme: 'Farm to Fork',
        subTopic: 'Table Manners',
        activityIntent: 'Match the Pairs',
        difficulty: 'easy',
        confidence: 0.95,
      });

      const selected = await service.select({
        grade: 'LKG',
        ageGroup: '3-4',
        subject: 'EVS',
        query: 'table manners matching',
      });

      expect(selected.id).toBe('farm-match');
      expect(aiService.select).not.toHaveBeenCalled();
      const telemetry = (selected as any)._selectionTelemetry;
      expect(telemetry.selectionMode).toBe('deterministic');
      expect(telemetry.selectionReason).toBe('decisive_rerank_margin');
      expect(telemetry.scoreMargin).toBeGreaterThanOrEqual(
        TEMPLATE_SELECTION_MIN_SCORE_MARGIN,
      );
    });

    it('calls Stage 3 LLM with top-N ids on near-tie', async () => {
      const a = template({
        id: 'a',
        slug: 'a',
        meta: { ageMin: 4, ageMax: 5, subjects: ['Math'] },
      });
      const b = template({
        id: 'b',
        slug: 'b',
        meta: { ageMin: 4, ageMax: 5, subjects: ['Math'] },
      });
      templateService.listActive.mockResolvedValue([a, b]);
      aiService.classify.mockResolvedValue({
        theme: null,
        subTopic: null,
        activityIntent: null,
        difficulty: null,
        confidence: 0,
      });
      aiService.select.mockResolvedValue({
        usedFallback: false,
        result: {
          selectedTemplateId: 'b',
          confidenceScore: 0.8,
          reasoning: 'better fit',
          alternativeTemplateId: 'a',
          catalogHash: 'x',
          latencyMs: 10,
        },
      });

      const selected = await service.select({
        ageGroup: '4-5',
        query: 'something vague',
      });

      expect(aiService.select).toHaveBeenCalledTimes(1);
      const call = aiService.select.mock.calls[0][0];
      expect(call.allowedTemplateIds).toEqual(expect.arrayContaining(['a', 'b']));
      expect(call.classification).toBeTruthy();
      expect(selected.id).toBe('b');
      expect((selected as any)._selectionTelemetry.selectionMode).toBe('ai');
    });

    it('falls back to top of rerank list on AI fallback reasons', async () => {
      const a = template({
        id: 'top',
        slug: 'top',
        updatedAt: new Date('2024-07-01'),
        meta: { ageMin: 4, ageMax: 5 },
      });
      const b = template({
        id: 'second',
        slug: 'second',
        updatedAt: new Date('2024-01-01'),
        meta: { ageMin: 4, ageMax: 5 },
      });
      templateService.listActive.mockResolvedValue([a, b]);
      aiService.classify.mockResolvedValue({
        theme: null,
        subTopic: null,
        activityIntent: null,
        difficulty: null,
        confidence: 0,
      });

      for (const reason of [
        'disabled',
        'missing_api_key',
        'circuit_open',
        'malformed_json',
        'invalid_id',
        'low_confidence',
        'timeout',
        'provider_error',
      ] as const) {
        aiService.select.mockResolvedValueOnce({
          usedFallback: true,
          fallbackReason: reason,
          result: null,
        });
        const selected = await service.select({
          ageGroup: '4-5',
          query: 'tie case',
        });
        expect(selected.id).toBe('top');
        expect((selected as any)._aiOutcome.fallbackReason).toBe(reason);
      }
    });

    it('scores theme/activity/difficulty/subject/grade per Stage 2 weights', () => {
      const classification: WorksheetTemplateIntentClassification = {
        theme: 'Farm to Fork',
        subTopic: 'Table Manners',
        activityIntent: 'Match the Pairs',
        difficulty: 'easy',
        confidence: 1,
      };
      const score = service.score(
        farmMatch,
        { grade: 'LKG', subject: 'EVS' },
        classification,
      );
      // theme +12, activity +10, subject +8, grade +6, difficulty +4
      expect(score).toBe(12 + 10 + 8 + 6 + 4);
    });

    it('adds +6 when request paraphrases selectionProfile exampleTopics (not literal match)', () => {
      const tracing = template({
        id: 'tracing',
        slug: 'tracing',
        meta: { ageMin: 3, ageMax: 5 },
        selectionProfile: {
          id: 'prof-1',
          templateId: 'tracing',
          templateSlug: 'tracing',
          templateType: 'visual_tracing',
          description: 'tracing',
          primaryUse: 'Pre-math, visual correspondence and fine-motor tracing activities.',
          canBeUsedFor: ['Big and small', 'Animal matching'],
          exampleTopics: ['Small animal to small house', 'Big fruit to big basket'],
          adaptationNote: 'Keep the dotted-line tracing interaction.',
          skillsPracticed: ['Fine motor skills'],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      const bare = template({
        id: 'bare',
        slug: 'bare',
        meta: { ageMin: 3, ageMax: 5 },
        selectionProfile: null,
      });

      const paraphrased = {
        ageGroup: '3-4',
        query: 'match each big elephant to its big house',
      };
      expect(service.matchesSelectionProfileTopics(tracing, paraphrased)).toBe(true);
      expect(service.score(tracing, paraphrased)).toBeGreaterThan(
        service.score(bare, paraphrased),
      );
      expect(service.score(tracing, paraphrased) - service.score(bare, paraphrased)).toBe(6);
    });

    it('prefers match_the_pairs over circle_the_things for "match the pairs of planets"', async () => {
      const matchPairs = template({
        id: 'cmthcnikx003yrobgnng3y2ka',
        slug: 'match_the_pairs',
        name: 'Match the Pairs',
        updatedAt: new Date('2024-01-01'),
        meta: {
          ageMin: 3,
          ageMax: 6,
          // Real DB rows often omit activityType — identity scoring must still work.
          subjects: ['thematic'],
        },
        selectionProfile: {
          id: 'p-match',
          templateId: 'cmthcnikx003yrobgnng3y2ka',
          templateSlug: 'match_the_pairs',
          templateType: 'two_column_matching',
          description: 'two-column matching',
          primaryUse: 'Two-column visual matching and one-to-one correspondence activities.',
          canBeUsedFor: ['Planets and planetary facts', 'Animals and habitats'],
          exampleTopics: ['Planet → planetary fact'],
          adaptationNote: 'Replace both columns with related sets.',
          skillsPracticed: ['Matching'],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      const circleThings = template({
        id: 'cmtctkipl002lxcbg6wqtf6q3',
        slug: 'circle_the_things',
        name: 'Circle the Things',
        updatedAt: new Date('2025-01-01'), // newer — would win ties before the fix
        meta: {
          ageMin: 3,
          ageMax: 6,
          subjects: ['general knowledge'],
        },
        selectionProfile: {
          id: 'p-circle',
          templateId: 'cmtctkipl002lxcbg6wqtf6q3',
          templateSlug: 'circle_the_things',
          templateType: 'visual_classification',
          description: 'circle classification',
          primaryUse: 'Visual classification and identify-the-correct-items activities.',
          canBeUsedFor: ['Fruits', 'Living and non-living things'],
          exampleTopics: ['Circle fruits', 'Circle living things'],
          adaptationNote: 'Mix category items with distractors.',
          skillsPracticed: ['Classification'],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const request = { ageGroup: '4-5', query: 'match the pairs of planets' };
      expect(service.matchesActivityIdentity(matchPairs, request)).toBe(true);
      expect(service.matchesActivityIdentity(circleThings, request)).toBe(false);
      expect(service.score(matchPairs, request)).toBeGreaterThan(
        service.score(circleThings, request) + TEMPLATE_SELECTION_MIN_SCORE_MARGIN - 1,
      );

      templateService.listActive.mockResolvedValue([circleThings, matchPairs]);
      aiService.classify.mockResolvedValue({
        theme: 'Mission: Space and Time',
        subTopic: 'Planets',
        activityIntent: 'Match the Pairs',
        difficulty: 'easy',
        confidence: 0.9,
      });

      const selected = await service.select(request);
      expect(selected.slug).toBe('match_the_pairs');
      expect(aiService.select).not.toHaveBeenCalled();
    });

    it('does not require a selectionProfile for scoring or selection', async () => {
      const only = template({
        id: 'no-profile',
        slug: 'no_profile',
        meta: { ageMin: 4, ageMax: 5, subjects: ['Math'] },
        selectionProfile: null,
      });
      templateService.listActive.mockResolvedValue([only]);
      const selected = await service.select({
        ageGroup: '4-5',
        query: 'count apples',
      });
      expect(selected.id).toBe('no-profile');
      expect(service.score(only, { query: 'count apples' })).toBe(0);
    });
  });
});

import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TemplateSelectionService } from './template-selection.service';
import { FlashcardException } from '../errors/flashcard.exception';

describe('TemplateSelectionService.selectByTemplateId', () => {
  const repository = {
    getTemplateById: jest.fn(),
    listActiveSelectionRules: jest.fn(),
  };

  const configService = {
    get: jest.fn().mockReturnValue(false),
  };

  const templateSelectionAi = {
    select: jest.fn(),
  };

  const service = new TemplateSelectionService(
    repository as never,
    configService as unknown as ConfigService,
    templateSelectionAi as never,
  );

  const template = {
    id: 'tmpl_image_word_sentence',
    name: 'Large Image + Word + Simple Sentence',
    description: null,
    templateType: 'flashcard',
    layoutType: 'VERTICAL',
    templateVersion: '1.0',
    supportedAgeGroups: ['3-4'],
    supportedGrades: [],
    learningObjectives: ['vocabulary'],
    subjectsSupported: [],
    difficultyLevels: ['easy'],
    tags: [],
    pageSize: 'A6',
    orientation: 'PORTRAIT',
    thumbnail: null,
    layoutDefinition: { regions: [] },
    active: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads an active template without running selection rules', async () => {
    repository.getTemplateById.mockResolvedValue(template);

    const result = await service.selectByTemplateId({
      templateId: 'tmpl_image_word_sentence',
      learningObjective: 'vocabulary',
      ageMin: 3,
      ageMax: 4,
      ageGroup: '3-4',
    });

    expect(repository.getTemplateById).toHaveBeenCalledWith(
      'tmpl_image_word_sentence',
    );
    expect(repository.listActiveSelectionRules).not.toHaveBeenCalled();
    expect(templateSelectionAi.select).not.toHaveBeenCalled();
    expect(result.template.id).toBe('tmpl_image_word_sentence');
    expect(result.selection).toEqual({
      ruleId: 'explicit-tmpl_image_word_sentence',
      ruleName: 'Explicit template from request',
      templateId: 'tmpl_image_word_sentence',
      priority: 0,
      score: 0,
      templateVersion: '1.0',
    });
  });

  it('rejects missing templates', async () => {
    repository.getTemplateById.mockResolvedValue(null);

    await expect(
      service.selectByTemplateId({
        templateId: 'missing',
        learningObjective: 'vocabulary',
        ageMin: 3,
        ageMax: 4,
        ageGroup: '3-4',
      }),
    ).rejects.toMatchObject({
      code: 'NO_TEMPLATE_FOUND',
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('rejects inactive templates', async () => {
    repository.getTemplateById.mockResolvedValue({
      ...template,
      active: false,
    });

    await expect(
      service.selectByTemplateId({
        templateId: template.id,
        learningObjective: 'vocabulary',
        ageMin: 3,
        ageMax: 4,
        ageGroup: '3-4',
      }),
    ).rejects.toMatchObject({
      code: 'TEMPLATE_VERSION_MISMATCH',
      status: HttpStatus.CONFLICT,
    });
  });

  it('rejects blank template ids', async () => {
    await expect(
      service.selectByTemplateId({
        templateId: '   ',
        learningObjective: 'vocabulary',
        ageMin: 3,
        ageMax: 4,
        ageGroup: '3-4',
      }),
    ).rejects.toBeInstanceOf(FlashcardException);
  });
});

describe('TemplateSelectionService.select with AI layer', () => {
  const repository = {
    getTemplateById: jest.fn(),
    listActiveSelectionRules: jest.fn(),
  };

  const configService = {
    get: jest.fn().mockReturnValue(false),
  };

  const templateSelectionAi = {
    select: jest.fn(),
  };

  const service = new TemplateSelectionService(
    repository as never,
    configService as unknown as ConfigService,
    templateSelectionAi as never,
  );

  const templateA = {
    id: 'tmpl_a',
    name: 'Picture & Label',
    description: 'Large image with a single vocabulary word',
    templateType: 'VOCABULARY',
    layoutType: 'VERTICAL',
    templateVersion: '1.0',
    supportedAgeGroups: ['3-4'],
    supportedGrades: [],
    learningObjectives: ['vocabulary'],
    subjectsSupported: ['general'],
    difficultyLevels: ['beginner'],
    tags: ['visual'],
    pageSize: 'A6',
    orientation: 'PORTRAIT',
    thumbnail: null,
    layoutDefinition: {
      regions: [
        {
          id: 'body',
          components: [
            { id: 'img', type: 'image', editable: true },
            { id: 'word', type: 'title', editable: true },
          ],
        },
      ],
    },
    active: true,
  };

  const templateB = {
    ...templateA,
    id: 'tmpl_b',
    name: 'Match the Pairs',
    description: 'Matching image with word',
    templateType: 'MATCHING',
    layoutType: 'TWO_COLUMN',
    learningObjectives: ['matching'],
  };

  const rules = [
    {
      id: 'rule_a',
      name: 'Rule A',
      priority: 100,
      ageMin: null,
      ageMax: null,
      grades: [],
      subjects: [],
      learningObjectives: [],
      difficulties: [],
      intents: [],
      topics: [],
      isFallback: false,
      templateId: 'tmpl_a',
      templateActive: true,
      templateAgeGroups: ['3-4'],
      templateAgeMin: 3,
      templateAgeMax: 4,
      templateSubjects: ['general'],
      templateObjectives: ['vocabulary'],
      templateDifficulties: ['beginner'],
      templateVersion: '1.0',
    },
    {
      id: 'rule_b',
      name: 'Rule B',
      priority: 90,
      ageMin: null,
      ageMax: null,
      grades: [],
      subjects: [],
      learningObjectives: [],
      difficulties: [],
      intents: [],
      topics: [],
      isFallback: false,
      templateId: 'tmpl_b',
      templateActive: true,
      templateAgeGroups: ['3-4'],
      templateAgeMin: 3,
      templateAgeMax: 4,
      templateSubjects: ['general'],
      templateObjectives: ['matching'],
      templateDifficulties: ['beginner'],
      templateVersion: '1.0',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    repository.listActiveSelectionRules.mockResolvedValue(rules);
  });

  it('uses AI pick when valid and high-confidence', async () => {
    templateSelectionAi.select.mockResolvedValue({
      result: {
        selectedTemplateId: 'tmpl_b',
        confidenceScore: 0.92,
        reasoning: 'Matching layout fits pair topic',
        alternativeTemplateId: 'tmpl_a',
        catalogHash: 'abc123',
        cachedInputTokens: 1200,
      },
      usedFallback: false,
      catalogHash: 'abc123',
    });
    repository.getTemplateById.mockResolvedValue(templateB);

    const result = await service.select({
      topic: 'match animals to names',
      ageMin: 3,
      ageMax: 4,
      ageGroup: '3-4',
      learningObjective: 'matching',
      objectiveConfidence: 'exact_keyword',
    });

    expect(templateSelectionAi.select).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'match animals to names',
        allowedTemplateIds: expect.arrayContaining(['tmpl_a', 'tmpl_b']),
        nativeTemplateIds: expect.arrayContaining(['tmpl_a', 'tmpl_b']),
      }),
    );
    expect(result.template.id).toBe('tmpl_b');
    expect(result.aiSelection?.selectionMode).toBe('ai');
    expect(result.aiSelection?.usedFallback).toBe(false);
  });

  it('falls back to deterministic rank when AI returns usedFallback', async () => {
    templateSelectionAi.select.mockResolvedValue({
      result: null,
      usedFallback: true,
      fallbackReason: 'timeout',
      catalogHash: 'abc123',
    });
    repository.getTemplateById.mockResolvedValue(templateA);

    const result = await service.select({
      topic: 'farm animals',
      ageMin: 3,
      ageMax: 4,
      ageGroup: '3-4',
      learningObjective: 'vocabulary',
      objectiveConfidence: 'exact_keyword',
    });

    expect(result.template.id).toBe('tmpl_a');
    expect(result.aiSelection?.selectionMode).toBe('deterministic');
    expect(result.aiSelection?.fallbackReason).toBe('timeout');
  });
});

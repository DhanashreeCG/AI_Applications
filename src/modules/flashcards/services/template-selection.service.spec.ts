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

  const service = new TemplateSelectionService(
    repository as never,
    configService as unknown as ConfigService,
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

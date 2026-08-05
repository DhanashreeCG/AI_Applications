import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@generated/prisma/client';
import { FlashcardTemplateService } from './flashcard-template.service';
import { FlashcardException } from '../errors/flashcard.exception';

describe('FlashcardTemplateService.upload', () => {
  const repository = {
    createTemplates: jest.fn(),
    listAllTemplateSummaries: jest.fn(),
  };

  const service = new FlashcardTemplateService(repository as never);

  const validDto = {
    name: 'classification_v1',
    description: 'Classify the object',
    templateType: 'CLASSIFICATION',
    layoutType: 'VERTICAL',
    supportedAgeGroups: ['5-6', '6-8'],
    learningObjectives: ['Classification'],
    subjectsSupported: ['General', 'Science'],
    difficultyLevels: ['Intermediate'],
    tags: ['classification', 'sorting'],
    layoutDefinition: {
      regions: [
        {
          id: 'body',
          components: [{ id: 'image', type: 'image', editable: true }],
        },
        {
          id: 'footer',
          components: [{ id: 'categories', type: 'chips', editable: true }],
        },
      ],
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    repository.createTemplates.mockImplementation(async (items: unknown[]) =>
      (items as Array<{ name: string }>).map((item, index) => ({
        id: `tmpl_auto_${index}`,
        ...validDto,
        name: item.name,
        supportedGrades: [],
        pageSize: 'A6',
        orientation: 'PORTRAIT',
        thumbnail: null,
        templateVersion: '1.0',
      })),
    );
  });

  it('creates multiple region-based templates without accepting ids', async () => {
    const second = {
      ...validDto,
      name: 'classification_v2',
    };

    const result = await service.upload({
      templates: [validDto, second],
    });

    expect(repository.createTemplates).toHaveBeenCalledTimes(1);
    expect(repository.createTemplates.mock.calls[0][0]).toHaveLength(2);
    expect(repository.createTemplates.mock.calls[0][0][0]).not.toHaveProperty(
      'id',
    );
    expect(result.count).toBe(2);
    expect(result.templates.map((item) => item.id)).toEqual([
      'tmpl_auto_0',
      'tmpl_auto_1',
    ]);
  });

  it('rejects an empty templates array', async () => {
    await expect(service.upload({ templates: [] })).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects layouts without editable region components', async () => {
    await expect(
      service.upload({
        templates: [
          {
            ...validDto,
            layoutDefinition: { regions: [] },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(FlashcardException);
  });

  it('maps unique name+version conflicts to HTTP 409', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint',
      {
        code: 'P2002',
        clientVersion: 'test',
      },
    );
    repository.createTemplates.mockRejectedValue(conflict);

    await expect(
      service.upload({ templates: [validDto] }),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
  });
});

describe('FlashcardTemplateService.listAll', () => {
  const repository = {
    listAllTemplateSummaries: jest.fn(),
  };

  const service = new FlashcardTemplateService(repository as never);

  it('returns id, name, templateType, and layoutType for each template', async () => {
    repository.listAllTemplateSummaries.mockResolvedValue([
      {
        id: 'tmpl_1',
        name: 'Large Image + Single Word',
        templateType: 'flashcard',
        layoutType: 'VERTICAL',
      },
      {
        id: 'tmpl_2',
        name: 'Image + Word + Fact',
        templateType: 'flashcard',
        layoutType: 'VERTICAL',
      },
    ]);

    const result = await service.listAll();

    expect(repository.listAllTemplateSummaries).toHaveBeenCalledTimes(1);
    expect(result.templates).toEqual([
      {
        id: 'tmpl_1',
        name: 'Large Image + Single Word',
        templateType: 'flashcard',
        layoutType: 'VERTICAL',
      },
      {
        id: 'tmpl_2',
        name: 'Image + Word + Fact',
        templateType: 'flashcard',
        layoutType: 'VERTICAL',
      },
    ]);
  });
});

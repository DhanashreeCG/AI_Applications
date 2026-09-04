import { EventEmitter2 } from '@nestjs/event-emitter';
import { FlashcardEditService } from './flashcard-edit.service';
import { FlashcardContentService } from './flashcard-content.service';
import { FlashcardImageRetrievalService } from './flashcard-image-retrieval.service';
import { FlashcardPersistenceService } from './flashcard-persistence.service';
import { FlashcardException } from '../errors/flashcard.exception';
import { GenerateFlashcardsResponse } from '../interfaces/flashcard.interfaces';

describe('FlashcardEditService', () => {
  const persistence = {
    getById: jest.fn(),
    updateCards: jest.fn(),
    requireSet: jest.fn(),
  };
  const contentService = {
    generateFieldReplacement: jest.fn(),
  };
  const imageRetrievalService = {
    retrieveForCard: jest.fn(),
    searchCandidates: jest.fn(),
    resolveLibraryAsset: jest.fn(),
    applyUserUploadedImage: jest.fn(),
    uploadUserImage: jest.fn(),
    loadUserUpload: jest.fn(),
  };
  const eventEmitter = { emit: jest.fn() };

  let service: FlashcardEditService;

  const payload: GenerateFlashcardsResponse = {
    id: 'fc-1',
    status: 'GENERATED',
    request: {
      query: 'apples',
      topic: 'apples',
      ageGroup: '3-4',
      ageMin: 3,
      ageMax: 4,
      grade: null,
      subject: null,
      difficulty: 'beginner',
      language: 'English',
      learningObjective: 'vocabulary',
      educationalIntent: 'recognition',
      count: 1,
    },
    selection: { ruleId: 'r1', ruleName: 'r', score: 1, priority: 1 },
    template: {
      id: 'tmpl-1',
      name: 'Word',
      description: null,
      templateType: 'WORD',
      layoutType: 'IMAGE_TOP',
      templateVersion: '1.0',
      supportedAgeGroups: ['3-4'],
      supportedGrades: [],
      learningObjectives: ['vocabulary'],
      subjectsSupported: [],
      difficultyLevels: [],
      tags: [],
      pageSize: 'A6',
      orientation: 'PORTRAIT',
      thumbnail: null,
      layoutDefinition: { regions: [] },
    },
    templateVersion: '1.0',
    layoutDefinition: { regions: [] },
    cards: [
      {
        cardId: 'card-1',
        cardIndex: 0,
        components: [
          {
            componentId: 'title',
            type: 'title',
            componentType: 'title',
            editable: true,
            content: 'Apple',
          },
          {
            componentId: 'hero',
            type: 'image',
            componentType: 'image',
            editable: true,
            content: null,
            assetReference: {
              assetId: 'old-asset',
              s3ObjectKey: 'assets/old.png',
              signedUrl: null,
              imageUrl: '/flashcards/assets/old-asset/image',
              userUploadedKey: null,
              caption: 'apple',
              similarity: 0.9,
              mimeType: 'image/png',
              status: 'found',
              queryUsed: 'red apple',
              attempts: ['red apple'],
            },
          },
        ],
      },
    ],
    metadata: {
      generatedAt: '2026-01-01T00:00:00.000Z',
      promptVersion: 'v1',
      contentModel: 'gemini',
      imageConcurrency: 3,
    },
    renderingMetadata: {
      generatedAt: '2026-01-01T00:00:00.000Z',
      promptVersion: 'v1',
      contentModel: 'gemini',
      imageConcurrency: 3,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FlashcardEditService(
      persistence as unknown as FlashcardPersistenceService,
      contentService as unknown as FlashcardContentService,
      imageRetrievalService as unknown as FlashcardImageRetrievalService,
      eventEmitter as unknown as EventEmitter2,
    );
    persistence.getById.mockResolvedValue(structuredClone(payload));
    persistence.updateCards.mockImplementation(
      async (_id: string, cards: GenerateFlashcardsResponse['cards']) => ({
        ...payload,
        cards,
      }),
    );
  });

  it('edits an editable text component and persists it', async () => {
    contentService.generateFieldReplacement.mockResolvedValue('Red apple');

    const result = await service.edit('fc-1', {
      cardId: 'card-1',
      componentId: 'title',
      instruction: 'Make it shorter',
    });

    expect(contentService.generateFieldReplacement).toHaveBeenCalled();
    expect(result.cards[0].components[0].content).toBe('Red apple');
    expect(imageRetrievalService.retrieveForCard).not.toHaveBeenCalled();
  });

  it('rejects a missing component', async () => {
    await expect(
      service.edit('fc-1', {
        cardId: 'card-1',
        componentId: 'missing',
        instruction: 'change it',
      }),
    ).rejects.toBeInstanceOf(FlashcardException);
  });

  it('re-resolves an image when an image component is edited', async () => {
    contentService.generateFieldReplacement.mockResolvedValue('green grapes');
    imageRetrievalService.retrieveForCard.mockResolvedValue({
      assetId: 'asset-999',
      s3ObjectKey: 'assets/new.png',
      signedUrl: null,
      imageUrl: '/flashcards/assets/asset-999/image',
      userUploadedKey: null,
      caption: 'grapes',
      similarity: 0.8,
      mimeType: 'image/png',
      status: 'found',
      queryUsed: 'green grapes',
      attempts: ['green grapes'],
    });

    const result = await service.edit('fc-1', {
      cardId: 'card-1',
      componentId: 'hero',
      instruction: 'Use grapes',
    });

    expect(imageRetrievalService.retrieveForCard).toHaveBeenCalled();
    expect(result.cards[0].components[1].assetReference?.assetId).toBe(
      'asset-999',
    );
  });

  it('saves text and image replacements in one write', async () => {
    imageRetrievalService.resolveLibraryAsset.mockResolvedValue({
      assetId: 'new-asset',
      s3ObjectKey: 'assets/new-asset.png',
      signedUrl: null,
      imageUrl: '/flashcards/assets/new-asset/image',
      userUploadedKey: null,
      caption: 'library',
      similarity: null,
      mimeType: 'image/png',
      status: 'found',
      queryUsed: 'red apple',
      attempts: [],
    });
    imageRetrievalService.applyUserUploadedImage.mockImplementation(
      (_prev: unknown, upload: { key: string; imageUrl: string }) => ({
        assetId: null,
        s3ObjectKey: upload.key,
        signedUrl: null,
        imageUrl: upload.imageUrl,
        userUploadedKey: upload.key,
        caption: 'User uploaded image',
        similarity: null,
        mimeType: 'image/png',
        status: 'found',
        queryUsed: 'red apple',
        attempts: [],
      }),
    );

    const library = await service.saveEdits('fc-1', {
      fields: [{ cardId: 'card-1', componentId: 'title', value: 'Pear' }],
      images: [{ cardId: 'card-1', componentId: 'hero', assetId: 'new-asset' }],
    });
    expect(library.cards[0].components[0].content).toBe('Pear');
    expect(library.cards[0].components[1].assetReference?.assetId).toBe(
      'new-asset',
    );

    const uploaded = await service.saveEdits('fc-1', {
      images: [
        {
          cardId: 'card-1',
          componentId: 'hero',
          userUploadedKey: 'flashcards/uploads/fc-1/abc.png',
        },
      ],
    });
    expect(uploaded.cards[0].components[1].assetReference?.assetId).toBeNull();
    expect(uploaded.cards[0].components[1].assetReference?.userUploadedKey).toBe(
      'flashcards/uploads/fc-1/abc.png',
    );
  });
});

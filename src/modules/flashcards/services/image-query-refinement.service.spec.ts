import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ImageQueryRefinementService } from './image-query-refinement.service';
import { AiUsageService } from '../../ai/services/ai-usage.service';
import { AssetVocabularyService } from './asset-vocabulary.service';
import { LlmCardContent } from '../interfaces/flashcard.interfaces';

describe('ImageQueryRefinementService', () => {
  let service: ImageQueryRefinementService;
  let configService: jest.Mocked<ConfigService>;
  let aiUsageService: jest.Mocked<AiUsageService>;
  let vocabularyService: jest.Mocked<AssetVocabularyService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  beforeEach(async () => {
    configService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    aiUsageService = {
      record: jest.fn(),
    } as unknown as jest.Mocked<AiUsageService>;

    vocabularyService = {
      getVocabularyPromptBlock: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AssetVocabularyService>;

    eventEmitter = {
      emit: jest.fn(),
    } as unknown as jest.Mocked<EventEmitter2>;

    configService.get.mockImplementation((key: string) => {
      if (key === 'flashcards.imageQueryRefinement.enabled') return true;
      if (key === 'flashcards.imageQueryRefinement.provider') return 'openai';
      if (key === 'ai.openaiApiKey') return 'test-key';
      if (key === 'flashcards.imageQueryRefinement.timeoutMs') return 1000;
      if (key === 'flashcards.imageQueryRefinement.maxAttempts') return 1;
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImageQueryRefinementService,
        { provide: ConfigService, useValue: configService },
        { provide: AiUsageService, useValue: aiUsageService },
        { provide: AssetVocabularyService, useValue: vocabularyService },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<ImageQueryRefinementService>(
      ImageQueryRefinementService,
    );

    // Mock the actual LLM call to prevent real network requests
    jest.spyOn(service as any, 'callLlm').mockImplementation(
      async (system, user, expectedSlotIds: string[]) => {
        return expectedSlotIds.map((id) => ({
          componentId: id,
          primaryConcept: 'mocked concept',
          requiredAttributes: [],
          searchQuery: 'mocked refined query',
        }));
      },
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('isEnabled', () => {
    it('returns true when enabled in config', () => {
      expect(service.isEnabled()).toBe(true);
    });

    it('returns false when disabled in config', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'flashcards.imageQueryRefinement.enabled') return false;
        return undefined;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ImageQueryRefinementService,
          { provide: ConfigService, useValue: configService },
          { provide: AiUsageService, useValue: aiUsageService },
          { provide: AssetVocabularyService, useValue: vocabularyService },
          { provide: EventEmitter2, useValue: eventEmitter },
        ],
      }).compile();

      const disabledService = module.get<ImageQueryRefinementService>(
        ImageQueryRefinementService,
      );

      expect(disabledService.isEnabled()).toBe(false);
    });
  });

  describe('refineQueries', () => {
    const mockCards: LlmCardContent[] = [
      {
        cardIndex: 0,
        textComponents: { title: 'Apple' },
        imageComponents: {
          image1: {
            searchQuery: 'apple fruit educational flashcard',
            expectedObjects: ['apple'],
          },
        },
      },
    ];

    it('returns without changes if disabled', async () => {
      jest.spyOn(service, 'isEnabled').mockReturnValue(false);
      // hacky way to override the private enabled flag for testing the short circuit
      (service as any).enabled = false;

      const result = await service.refineQueries({
        cards: mockCards,
        topic: 'Fruits',
        learningObjective: 'vocabulary',
        allowLineArt: false,
      });

      expect(result.refined).toBe(false);
      expect(result.changes).toHaveLength(0);
      expect(service['callLlm']).not.toHaveBeenCalled();
    });

    it('returns without changes if no image slots exist', async () => {
      const result = await service.refineQueries({
        cards: [{ cardIndex: 0, textComponents: {}, imageComponents: {} }],
        topic: 'Fruits',
        learningObjective: 'vocabulary',
        allowLineArt: false,
      });

      expect(result.refined).toBe(false);
      expect(result.changes).toHaveLength(0);
      expect(service['callLlm']).not.toHaveBeenCalled();
    });

    it('refines queries and mutates the cards in place', async () => {
      const cards = JSON.parse(JSON.stringify(mockCards)); // Deep copy

      const result = await service.refineQueries({
        cards,
        topic: 'Fruits',
        learningObjective: 'vocabulary',
        allowLineArt: false,
      });

      expect(result.refined).toBe(true);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toEqual({
        componentId: 'image1',
        cardIndex: 0,
        originalQuery: 'apple fruit educational flashcard',
        refinedQuery: 'mocked refined query',
      });
      // Verify in-place mutation
      expect(cards[0].imageComponents.image1.searchQuery).toBe(
        'mocked refined query',
      );
    });

    it('falls back to original queries on LLM failure', async () => {
      const cards = JSON.parse(JSON.stringify(mockCards)); // Deep copy
      jest
        .spyOn(service as any, 'callLlm')
        .mockRejectedValue(new Error('LLM error'));

      const result = await service.refineQueries({
        cards,
        topic: 'Fruits',
        learningObjective: 'vocabulary',
        allowLineArt: false,
      });

      expect(result.refined).toBe(false);
      expect(result.changes).toHaveLength(0);
      // Verify no mutation occurred
      expect(cards[0].imageComponents.image1.searchQuery).toBe(
        'apple fruit educational flashcard',
      );
    });
  });
});

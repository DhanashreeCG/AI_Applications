import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TemplateSelectionAiService } from './template-selection-ai.service';
import { TemplateCatalogCacheService } from './template-catalog-cache.service';
import { AiUsageService } from '../../ai/services/ai-usage.service';
import { deriveComponentSummary } from './template-catalog-cache.service';

describe('deriveComponentSummary', () => {
  it('summarizes editable component counts deterministically', () => {
    const summary = deriveComponentSummary({
      regions: [
        {
          id: 'body',
          components: [
            { id: 'img1', type: 'image', editable: true },
            { id: 'img2', type: 'image', editable: true },
            { id: 'word', type: 'title', editable: true },
            { id: 'frame', type: 'badge', editable: false },
          ],
        },
      ],
    });

    expect(summary).toBe('2 image + 1 title');
  });

  it('returns unknown layout for invalid definitions', () => {
    expect(deriveComponentSummary(null)).toBe('unknown layout');
  });
});

describe('TemplateSelectionAiService fallbacks', () => {
  function buildService(overrides?: {
    enabled?: boolean;
    provider?: string;
    openaiApiKey?: string | undefined;
    geminiApiKey?: string | undefined;
    minConfidence?: number;
  }) {
    const configMap: Record<string, unknown> = {
      'flashcards.templateSelectionAi.enabled': overrides?.enabled ?? true,
      'flashcards.templateSelectionAi.provider': overrides?.provider ?? 'openai',
      'flashcards.templateSelectionAi.openaiModel': 'gpt-4.1-mini',
      'flashcards.templateSelectionAi.geminiModel': 'gemini-2.5-flash',
      'flashcards.templateSelectionAi.minConfidence':
        overrides?.minConfidence ?? 0.5,
      'flashcards.templateSelectionAi.timeoutMs': 6000,
      'flashcards.templateSelectionAi.costPerMInputUsd': 0.4,
      'flashcards.templateSelectionAi.costPerMCachedInputUsd': 0.1,
      'flashcards.templateSelectionAi.costPerMOutputUsd': 1.6,
      'ai.openaiMaxRps': 10,
      'ai.geminiMaxRps': 2,
      'ai.circuitFailureThreshold': 5,
      'ai.circuitCooldownMs': 60000,
      'ai.openaiApiKey':
        overrides && 'openaiApiKey' in overrides
          ? overrides.openaiApiKey
          : 'sk-test',
      'ai.geminiApiKey':
        overrides && 'geminiApiKey' in overrides
          ? overrides.geminiApiKey
          : 'gemini-test',
      'pipelineTracking.storeAiPayload': false,
    };

    const configService = {
      get: jest.fn((key: string) => configMap[key]),
    } as unknown as ConfigService;

    const aiUsageService = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AiUsageService;

    const catalogCache = {
      getSnapshot: jest.fn().mockResolvedValue({
        catalogBlock: 'TEMPLATE CATALOG\n{"templates":[]}',
        catalogHash: 'hash123',
        entries: [],
        builtAt: Date.now(),
      }),
      invalidate: jest.fn(),
    } as unknown as TemplateCatalogCacheService;

    const eventEmitter = {
      emit: jest.fn(),
    } as unknown as EventEmitter2;

    const service = new TemplateSelectionAiService(
      configService,
      aiUsageService,
      catalogCache,
      eventEmitter,
    );

    return { service, aiUsageService, catalogCache };
  }

  it('falls back when disabled', async () => {
    const { service, catalogCache } = buildService({ enabled: false });
    const outcome = await service.select({
      topic: 'farm animals',
      ageGroup: '3-4',
      learningObjective: 'vocabulary',
      allowedTemplateIds: ['a', 'b'],
    });
    expect(outcome.usedFallback).toBe(true);
    expect(outcome.fallbackReason).toBe('disabled');
    expect(catalogCache.getSnapshot).not.toHaveBeenCalled();
  });

  it('falls back for a single candidate without calling the provider', async () => {
    const { service, catalogCache } = buildService();
    const outcome = await service.select({
      topic: 'farm animals',
      ageGroup: '3-4',
      learningObjective: 'vocabulary',
      allowedTemplateIds: ['only-one'],
    });
    expect(outcome.usedFallback).toBe(true);
    expect(outcome.fallbackReason).toBe('single_candidate');
    expect(catalogCache.getSnapshot).not.toHaveBeenCalled();
  });

  it('falls back when API key is missing', async () => {
    const { service } = buildService({
      provider: 'openai',
      openaiApiKey: undefined,
    });
    const outcome = await service.select({
      topic: 'farm animals',
      ageGroup: '3-4',
      learningObjective: 'vocabulary',
      allowedTemplateIds: ['a', 'b'],
    });
    expect(outcome.usedFallback).toBe(true);
    expect(outcome.fallbackReason).toBe('missing_api_key');
  });

  it('falls back when no candidates are provided', async () => {
    const { service } = buildService();
    const outcome = await service.select({
      topic: 'farm animals',
      ageGroup: '3-4',
      learningObjective: 'vocabulary',
      allowedTemplateIds: [],
    });
    expect(outcome.usedFallback).toBe(true);
    expect(outcome.fallbackReason).toBe('no_candidates');
  });
});

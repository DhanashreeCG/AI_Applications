import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { getErrorMessage } from '../../../common/utils/error-message';
import {
  PIPELINE_STAGES,
  PipelineTelemetryContext,
} from '../../../common/events/pipeline-tracker.events';
import { AiUsageService } from '../../ai/services/ai-usage.service';
import { CircuitBreaker } from '../../ai/utils/circuit-breaker.util';
import { RateLimiter } from '../../ai/utils/rate-limiter.util';
import {
  FLASHCARD_IMAGE_QUERY_REFINEMENT_STAGE,
  DEFAULT_IMAGE_QUERY_REFINEMENT_TIMEOUT_MS,
  DEFAULT_IMAGE_QUERY_REFINEMENT_MAX_ATTEMPTS,
  DEFAULT_IMAGE_QUERY_REFINEMENT_RETRY_DELAY_MS,
} from '../constants/flashcard.constants';
import {
  buildImageQueryRefinementPrompt,
  buildImageQueryRefinementSchema,
  parseRefinementResponse,
  type ImageSlotForRefinement,
  type RefinedImageSlot,
} from '../constants/image-query-refinement.prompt';
import type {
  ImageSearchQuery,
  LlmCardContent,
} from '../interfaces/flashcard.interfaces';
import {
  FlashcardPipelineEmitter,
  hashPayload,
} from '../telemetry/flashcard-pipeline.events';
import { AssetVocabularyService } from './asset-vocabulary.service';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface RefineImageQueriesInput {
  /** The LLM-generated card content — image queries will be refined in place. */
  cards: LlmCardContent[];
  topic: string;
  learningObjective: string;
  allowLineArt: boolean;
  countryCode?: string;
}

export interface RefineImageQueriesResult {
  /** Whether the LLM refinement was applied (false = fallback to originals). */
  refined: boolean;
  /** Per-slot refinement details for telemetry. */
  changes: Array<{
    componentId: string;
    cardIndex: number;
    originalQuery: string;
    refinedQuery: string;
  }>;
  /** Total LLM latency in ms (0 if skipped). */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ImageQueryRefinementService {
  private readonly logger = new Logger(ImageQueryRefinementService.name);
  private readonly enabled: boolean;
  private readonly provider: string;
  private readonly modelName: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;

  private geminiClient: GoogleGenAI | null;
  private openaiClient: OpenAI | null;
  private readonly rateLimiter: RateLimiter;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly emitter: FlashcardPipelineEmitter;

  constructor(
    private readonly configService: ConfigService,
    private readonly aiUsageService: AiUsageService,
    private readonly vocabularyService: AssetVocabularyService,
    eventEmitter: EventEmitter2,
  ) {
    this.enabled =
      this.configService.get<boolean>(
        'flashcards.imageQueryRefinement.enabled',
      ) !== false;

    this.provider =
      this.configService.get<string>(
        'flashcards.imageQueryRefinement.provider',
      ) || 'gemini';

    this.modelName =
      this.provider === 'openai'
        ? (this.configService.get<string>(
            'flashcards.imageQueryRefinement.openaiModel',
          ) || 'gpt-4o-mini')
        : (this.configService.get<string>(
            'flashcards.imageQueryRefinement.geminiModel',
          ) || 'gemini-2.0-flash-lite');

    this.timeoutMs =
      this.configService.get<number>(
        'flashcards.imageQueryRefinement.timeoutMs',
      ) ?? DEFAULT_IMAGE_QUERY_REFINEMENT_TIMEOUT_MS;

    this.maxAttempts = Math.max(
      1,
      this.configService.get<number>(
        'flashcards.imageQueryRefinement.maxAttempts',
      ) ?? DEFAULT_IMAGE_QUERY_REFINEMENT_MAX_ATTEMPTS,
    );

    this.retryDelayMs = Math.max(
      0,
      this.configService.get<number>(
        'flashcards.imageQueryRefinement.retryDelayMs',
      ) ?? DEFAULT_IMAGE_QUERY_REFINEMENT_RETRY_DELAY_MS,
    );

    this.rateLimiter = new RateLimiter(
      this.provider === 'openai' ? 10 : 5,
    );
    this.circuitBreaker = new CircuitBreaker(
      `${this.provider}-image-query-refinement`,
      3,
      30_000,
    );
    this.emitter = new FlashcardPipelineEmitter(eventEmitter);

    // Initialize clients
    const geminiApiKey = this.configService.get<string>('ai.geminiApiKey');
    const openaiApiKey = this.configService.get<string>('ai.openaiApiKey');
    this.geminiClient = geminiApiKey
      ? new GoogleGenAI({ apiKey: geminiApiKey })
      : null;
    this.openaiClient = openaiApiKey
      ? new OpenAI({ apiKey: openaiApiKey })
      : null;

    if (this.enabled) {
      const available =
        (this.provider === 'gemini' && this.geminiClient) ||
        (this.provider === 'openai' && this.openaiClient);
      if (!available) {
        this.logger.warn(
          `ImageQueryRefinement enabled but ${this.provider} client not initialized (missing API key). Will fall back to original queries.`,
        );
      } else {
        this.logger.log(
          `ImageQueryRefinement enabled: provider=${this.provider}, model=${this.modelName}, timeout=${this.timeoutMs}ms, maxAttempts=${this.maxAttempts}`,
        );
      }
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Refine all image search queries across all cards using a lightweight LLM.
   * Mutates `cards` in place — replaces each `imageComponents[x].searchQuery`
   * with the refined version. Falls back to originals on any failure.
   */
  public async refineQueries(
    input: RefineImageQueriesInput,
    telemetry?: PipelineTelemetryContext,
  ): Promise<RefineImageQueriesResult> {
    if (!this.enabled) {
      return { refined: false, changes: [], durationMs: 0 };
    }

    const clientAvailable =
      (this.provider === 'gemini' && this.geminiClient) ||
      (this.provider === 'openai' && this.openaiClient);
    if (!clientAvailable) {
      return { refined: false, changes: [], durationMs: 0 };
    }

    // Collect all image slots across all cards
    const slots: Array<ImageSlotForRefinement & { cardIndex: number }> = [];
    for (const card of input.cards) {
      // Build a short text summary for context
      const textValues = Object.values(card.textComponents);
      const cardTextSummary =
        textValues.length > 0
          ? textValues.slice(0, 3).join(', ')
          : undefined;

      for (const [componentId, query] of Object.entries(
        card.imageComponents,
      )) {
        slots.push({
          componentId: `${card.cardIndex}-${componentId}`,
          searchQuery: query.searchQuery,
          expectedObjects: query.expectedObjects ?? [],
          preferredStyle: query.preferredStyle,
          cardTextSummary,
          cardIndex: card.cardIndex,
        });
      }
    }

    if (slots.length === 0) {
      return { refined: false, changes: [], durationMs: 0 };
    }

    // Emit stage started
    if (telemetry) {
      this.emitter.emitStageStarted({
        ...telemetry,
        stageName: PIPELINE_STAGES.IMAGE_QUERY_REFINEMENT,
        metadata: {
          slotCount: slots.length,
          provider: this.provider,
          model: this.modelName,
        },
      });
    }

    const startedAt = Date.now();

    try {
      // Load asset vocabulary if enabled
      const assetVocabulary =
        await this.vocabularyService.getVocabularyPromptBlock();

      // Build prompt
      const { system, user } = buildImageQueryRefinementPrompt({
        slots,
        topic: input.topic,
        learningObjective: input.learningObjective,
        allowLineArt: input.allowLineArt,
        assetVocabulary,
      });

      // Call LLM with retry
      const refined = await this.callWithRetry(
        system,
        user,
        slots.map((s) => s.componentId),
        telemetry,
      );

      // Apply refinements to the cards (mutate in place)
      const changes = this.applyRefinements(input.cards, slots, refined!);

      const durationMs = Date.now() - startedAt;

      if (telemetry) {
        this.emitter.emitStageCompleted({
          ...telemetry,
          stageName: PIPELINE_STAGES.IMAGE_QUERY_REFINEMENT,
          metadata: {
            refined: true,
            slotCount: slots.length,
            changedCount: changes.length,
            durationMs,
          },
        });
      }

      if (changes.length > 0) {
        for (const change of changes) {
          this.logger.log(
            `Image query refined on card ${change.cardIndex} "${change.componentId}": ` +
              `"${change.originalQuery}" → "${change.refinedQuery}"`,
          );
        }
      }

      return { refined: true, changes, durationMs };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.logger.warn(
        `Image query refinement failed; using original queries: ${getErrorMessage(error)}`,
      );

      if (telemetry) {
        this.emitter.emitStageFailed({
          ...telemetry,
          stageName: PIPELINE_STAGES.IMAGE_QUERY_REFINEMENT,
          errorMessage: getErrorMessage(error),
          metadata: { durationMs },
        });
      }

      return { refined: false, changes: [], durationMs };
    }
  }

  // -------------------------------------------------------------------------
  // LLM call with retry
  // -------------------------------------------------------------------------

  private async callWithRetry(
    system: string,
    user: string,
    expectedSlotIds: string[],
    telemetry?: PipelineTelemetryContext,
  ): Promise<RefinedImageSlot[] | null> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.callLlm(
          system,
          user,
          expectedSlotIds,
          telemetry,
          attempt,
        );
      } catch (error) {
        lastError = error;

        // Don't retry client errors
        if (error instanceof HttpException && error.getStatus() < 500) {
          throw error;
        }

        this.logger.warn(
          `Image query refinement attempt ${attempt}/${this.maxAttempts} failed: ${getErrorMessage(error)}`,
        );

        if (attempt < this.maxAttempts && this.retryDelayMs > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.retryDelayMs),
          );
        }
      }
    }

    // All retries exhausted — throw to trigger fallback and log the exact error
    this.logger.warn(
      `Image query refinement exhausted ${this.maxAttempts} attempts: ${getErrorMessage(lastError)}`,
    );
    throw lastError || new Error('Unknown LLM error');
  }

  private async callLlm(
    system: string,
    user: string,
    expectedSlotIds: string[],
    telemetry?: PipelineTelemetryContext,
    attempt = 1,
  ): Promise<RefinedImageSlot[] | null> {
    this.circuitBreaker.beforeRequest();
    await this.rateLimiter.acquire();

    const invocationId = randomUUID();
    const startedAt = new Date();

    if (telemetry) {
      this.emitter.emitAiStarted({
        ...telemetry,
        invocationId,
        stageName: PIPELINE_STAGES.IMAGE_QUERY_REFINEMENT,
        provider: this.provider === 'openai' ? 'openai' : 'google-gemini',
        model: this.modelName,
        purpose: FLASHCARD_IMAGE_QUERY_REFINEMENT_STAGE,
        promptHash: hashPayload(user),
        promptPayload: { system, user },
        retryCount: attempt - 1,
      });
    }

    let responseText: string | undefined;
    let usage: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    } | undefined;

    try {
      if (this.provider === 'openai') {
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          this.timeoutMs,
        );
        try {
          const response = await this.openaiClient!.chat.completions.create(
            {
              model: this.modelName,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
              ],
              response_format: { type: 'json_object' },
            },
            { signal: controller.signal },
          );
          responseText = response.choices[0]?.message?.content?.trim();
          usage = {
            promptTokenCount: response.usage?.prompt_tokens,
            candidatesTokenCount: response.usage?.completion_tokens,
            totalTokenCount: response.usage?.total_tokens,
          };
        } finally {
          clearTimeout(timer);
        }
      } else {
        // Gemini
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          this.timeoutMs,
        );
        try {
          const response =
            await this.geminiClient!.models.generateContent({
              model: this.modelName,
              contents: [
                {
                  role: 'user',
                  parts: [{ text: `${system}\n\n${user}` }],
                },
              ],
              config: {
                responseMimeType: 'application/json',
                responseSchema: buildImageQueryRefinementSchema() as any,
              },
            });
          responseText = response.text?.trim();
          const geminiUsage = (
            response as { usageMetadata?: Record<string, number> }
          ).usageMetadata;
          usage = geminiUsage
            ? {
                promptTokenCount: geminiUsage.promptTokenCount,
                candidatesTokenCount: geminiUsage.candidatesTokenCount,
                totalTokenCount: geminiUsage.totalTokenCount,
              }
            : undefined;
        } finally {
          clearTimeout(timer);
        }
      }

      const latencyMs = Date.now() - startedAt.getTime();

      if (!responseText) {
        this.circuitBreaker.recordFailure();
        if (telemetry) {
          this.emitter.emitAiCompleted({
            ...telemetry,
            invocationId,
            stageName: PIPELINE_STAGES.IMAGE_QUERY_REFINEMENT,
            status: 'failed',
            errorMessage: 'Empty response from LLM',
            durationMs: latencyMs,
          });
        }
        return null;
      }

      let parsed: unknown;
      try {
        const cleanedText = responseText
          .replace(/^```(?:json)?\n?/, '')
          .replace(/```$/, '')
          .trim();
        parsed = JSON.parse(cleanedText);
      } catch {
        // We throw so that callLlm's catch block can handle telemetry and rethrow for retries.
        throw Object.assign(new Error('Invalid JSON response'), { payload: responseText });
      }

      const result = parseRefinementResponse(parsed, expectedSlotIds);

      if (!result) {
        throw Object.assign(new Error('Invalid response structure (missing expected slots)'), { payload: parsed });
      }

      this.circuitBreaker.recordSuccess();

      // Track AI usage
      await this.aiUsageService.record({
        stage: FLASHCARD_IMAGE_QUERY_REFINEMENT_STAGE,
        provider: this.provider === 'openai' ? 'openai' : 'google-gemini',
        model: this.modelName,
        startedAt,
        completedAt: new Date(),
        latencyMs,
        inputTokens: usage?.promptTokenCount,
        outputTokens: usage?.candidatesTokenCount,
        totalTokens: usage?.totalTokenCount,
        status: 'success',
        retryCount: attempt - 1,
      });

      if (telemetry) {
        this.emitter.emitAiCompleted({
          ...telemetry,
          invocationId,
          stageName: PIPELINE_STAGES.IMAGE_QUERY_REFINEMENT,
          status: 'success',
          responseHash: hashPayload(responseText),
          responsePayload: parsed,
          inputTokens: usage?.promptTokenCount,
          outputTokens: usage?.candidatesTokenCount,
          totalTokens: usage?.totalTokenCount,
          durationMs: latencyMs,
        });
      }

      return result;
    } catch (error) {
      this.circuitBreaker.recordFailure();
      const latencyMs = Date.now() - startedAt.getTime();

      await this.aiUsageService.record({
        stage: FLASHCARD_IMAGE_QUERY_REFINEMENT_STAGE,
        provider: this.provider === 'openai' ? 'openai' : 'google-gemini',
        model: this.modelName,
        startedAt,
        completedAt: new Date(),
        latencyMs,
        status: 'failed',
        retryCount: attempt - 1,
        errorType: getErrorMessage(error),
      });

      if (telemetry) {
        const badPayload = (error as any).payload;
        this.emitter.emitAiCompleted({
          ...telemetry,
          invocationId,
          stageName: PIPELINE_STAGES.IMAGE_QUERY_REFINEMENT,
          status: 'failed',
          errorMessage: getErrorMessage(error),
          responsePayload: badPayload,
          durationMs: latencyMs,
        });
      }

      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Apply refinements
  // -------------------------------------------------------------------------

  private applyRefinements(
    cards: LlmCardContent[],
    originalSlots: Array<ImageSlotForRefinement & { cardIndex: number }>,
    refined: RefinedImageSlot[],
  ): RefineImageQueriesResult['changes'] {
    const refinedMap = new Map(
      refined.map((r) => [r.componentId, r]),
    );
    const changes: RefineImageQueriesResult['changes'] = [];

    for (const card of cards) {
      for (const [componentId, query] of Object.entries(
        card.imageComponents,
      )) {
        const uniqueId = `${card.cardIndex}-${componentId}`;
        const refinedSlot = refinedMap.get(uniqueId);
        if (!refinedSlot) continue;

        const originalQuery = query.searchQuery;
        const refinedQuery = refinedSlot.searchQuery;

        if (refinedQuery && refinedQuery !== originalQuery) {
          // Mutate in place — the orchestrator expects this
          card.imageComponents[componentId] = {
            ...query,
            searchQuery: refinedQuery,
          } satisfies ImageSearchQuery;

          changes.push({
            componentId,
            cardIndex: card.cardIndex,
            originalQuery,
            refinedQuery,
          });
        }
      }
    }

    return changes;
  }
}

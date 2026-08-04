import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GoogleGenAI } from '@google/genai';
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
  DEFAULT_FLASHCARD_PROMPT_VERSION,
  buildFlashcardContentPrompt,
  buildFlashcardContentSchema,
} from '../constants/flashcard-prompt.constants';
import { FLASHCARD_CONTENT_STAGE } from '../constants/flashcard.constants';
import { FlashcardException } from '../errors/flashcard.exception';
import {
  LlmFlashcardPayload,
  TemplateComponentDefinition,
} from '../interfaces/flashcard.interfaces';
import {
  FlashcardPipelineEmitter,
  hashPayload,
} from '../telemetry/flashcard-pipeline.events';
import {
  validateLlmCardContent,
  validateLlmFlashcardPayload,
} from '../utils/llm-content.validator';

export interface GenerateContentInput {
  query: string;
  topic: string;
  ageMin: number;
  ageMax: number;
  learningObjective: string;
  count: number;
  textComponents: TemplateComponentDefinition[];
  grade?: string | null;
  subject?: string | null;
  difficulty?: string | null;
  language?: string;
}

@Injectable()
export class FlashcardContentService {
  private readonly logger = new Logger(FlashcardContentService.name);
  private client: GoogleGenAI | null;
  private readonly modelName: string;
  private readonly promptVersion: string;
  private readonly rateLimiter: RateLimiter;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly emitter: FlashcardPipelineEmitter;

  constructor(
    private readonly configService: ConfigService,
    private readonly aiUsageService: AiUsageService,
    eventEmitter: EventEmitter2,
  ) {
    const apiKey = this.configService.get<string>('ai.geminiApiKey');
    this.modelName =
      this.configService.get<string>('ai.geminiModel') || 'gemini-2.5-flash';
    this.promptVersion =
      this.configService.get<string>('ai.flashcardPromptVersion') ||
      DEFAULT_FLASHCARD_PROMPT_VERSION;

    const maxRps = this.configService.get<number>('ai.geminiMaxRps') ?? 2;
    const failureThreshold =
      this.configService.get<number>('ai.circuitFailureThreshold') ?? 5;
    const cooldownMs =
      this.configService.get<number>('ai.circuitCooldownMs') ?? 60000;

    this.rateLimiter = new RateLimiter(maxRps);
    this.circuitBreaker = new CircuitBreaker(
      'gemini-flashcard-content',
      failureThreshold,
      cooldownMs,
    );
    this.emitter = new FlashcardPipelineEmitter(eventEmitter);

    this.client = apiKey ? new GoogleGenAI({ apiKey }) : null;
    if (!apiKey) {
      this.logger.warn(
        'GEMINI_API_KEY not provided. FlashcardContentService is unavailable.',
      );
    }
  }

  public getPromptVersion(): string {
    return this.promptVersion;
  }

  public getModelName(): string {
    return this.modelName;
  }

  public setClient(client: GoogleGenAI): void {
    this.client = client;
  }

  public async generateContent(
    input: GenerateContentInput,
    telemetry?: PipelineTelemetryContext,
  ): Promise<LlmFlashcardPayload> {
    if (telemetry) {
      this.emitter.emitStageStarted({
        ...telemetry,
        stageName: PIPELINE_STAGES.LLM_CONTENT_GENERATION,
      });
      this.emitter.emitStageStarted({
        ...telemetry,
        stageName: PIPELINE_STAGES.IMAGE_QUERY_GENERATION,
      });
    }

    try {
      let payload: LlmFlashcardPayload;
      try {
        payload = await this.requestContent(input, undefined, telemetry);
      } catch (error) {
        if (
          !(error instanceof FlashcardException) ||
          error.code !== 'INVALID_LLM_OUTPUT'
        ) {
          throw error;
        }

        this.logger.warn(
          `Retrying full flashcard content generation after invalid output: ${getErrorMessage(error)}`,
        );
        payload = await this.requestContent(
          input,
          getErrorMessage(error),
          telemetry,
          1,
        );
      }

      if (telemetry) {
        this.emitter.emitStageCompleted({
          ...telemetry,
          stageName: PIPELINE_STAGES.IMAGE_QUERY_GENERATION,
          metadata: {
            queryCount: payload.cards.reduce(
              (sum, card) => sum + card.imageSearchQueries.length,
              0,
            ),
          },
        });
        this.emitter.emitStageCompleted({
          ...telemetry,
          stageName: PIPELINE_STAGES.LLM_CONTENT_GENERATION,
          metadata: { cardCount: payload.cards.length },
        });
      }

      return payload;
    } catch (error) {
      if (telemetry) {
        this.emitter.emitStageFailed({
          ...telemetry,
          stageName: PIPELINE_STAGES.LLM_CONTENT_GENERATION,
          errorMessage: getErrorMessage(error),
        });
      }
      throw error;
    }
  }

  /**
   * Regenerate a single card. Never regenerates the full flashcard set.
   */
  public async regenerateCard(
    input: Omit<GenerateContentInput, 'count'>,
    cardIndex: number,
    reason: string,
    telemetry?: PipelineTelemetryContext,
  ): Promise<LlmFlashcardPayload['cards'][number]> {
    const single = await this.requestContent(
      { ...input, count: 1 },
      `Card ${cardIndex} was invalid: ${reason}. Return exactly 1 corrected card as cards[0].`,
      telemetry,
      1,
    );
    return { ...single.cards[0], cardIndex };
  }

  private async requestContent(
    input: GenerateContentInput,
    correction?: string,
    telemetry?: PipelineTelemetryContext,
    retryCount = 0,
  ): Promise<LlmFlashcardPayload> {
    if (!this.client) {
      throw new FlashcardException(
        'RETRY_EXHAUSTION',
        'Gemini content client is not initialized',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (telemetry) {
      this.emitter.emitStageStarted({
        ...telemetry,
        stageName: PIPELINE_STAGES.PROMPT_GENERATION,
      });
    }

    const basePrompt = buildFlashcardContentPrompt(input);
    const prompt = correction
      ? `${basePrompt}\n\nYour previous response was rejected: ${correction}\nReturn corrected JSON using the exact component keys listed above.`
      : basePrompt;

    if (telemetry) {
      this.emitter.emitStageCompleted({
        ...telemetry,
        stageName: PIPELINE_STAGES.PROMPT_GENERATION,
      });
      this.emitter.emitStageStarted({
        ...telemetry,
        stageName: PIPELINE_STAGES.LLM_REQUEST,
      });
    }

    const invocationId = randomUUID();
    const startedAt = new Date();
    let latencyMs = 0;

    if (telemetry) {
      this.emitter.emitAiStarted({
        ...telemetry,
        invocationId,
        stageName: PIPELINE_STAGES.LLM_REQUEST,
        provider: 'google-gemini',
        model: this.modelName,
        purpose: FLASHCARD_CONTENT_STAGE,
        promptHash: hashPayload(prompt),
        promptPayload: prompt,
        retryCount,
      });
    }

    try {
      this.circuitBreaker.beforeRequest();
      await this.rateLimiter.acquire();

      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: buildFlashcardContentSchema(input.textComponents),
        },
      });

      latencyMs = Date.now() - startedAt.getTime();
      const usage = (response as { usageMetadata?: Record<string, number> })
        .usageMetadata;
      const requestId = (response as { responseId?: string }).responseId;

      const responseText = response.text?.trim();
      if (!responseText) {
        throw new FlashcardException(
          'INVALID_LLM_OUTPUT',
          'LLM returned an empty response',
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        throw new FlashcardException(
          'INVALID_LLM_OUTPUT',
          'LLM response was not valid JSON',
        );
      }

      const inputTokens =
        usage?.promptTokenCount ?? usage?.inputTokenCount ?? undefined;
      const outputTokens =
        usage?.candidatesTokenCount ?? usage?.outputTokenCount ?? undefined;
      const totalTokens = usage?.totalTokenCount ?? undefined;

      if (telemetry) {
        this.emitter.emitStageCompleted({
          ...telemetry,
          stageName: PIPELINE_STAGES.LLM_REQUEST,
          metadata: {
            inputTokens,
            outputTokens,
            totalTokens,
            durationMs: latencyMs,
            model: this.modelName,
          },
        });
        this.emitter.emitStageStarted({
          ...telemetry,
          stageName: PIPELINE_STAGES.CONTENT_VALIDATION,
        });
      }

      const payload = await this.validateOrRepairCards(
        parsed,
        input,
        telemetry,
        retryCount,
      );

      if (telemetry) {
        this.emitter.emitStageCompleted({
          ...telemetry,
          stageName: PIPELINE_STAGES.CONTENT_VALIDATION,
          metadata: {
            cardCount: payload.cards.length,
            responsePreview: {
              cardCount: payload.cards.length,
              cardIndexes: payload.cards.map((card) => card.cardIndex),
            },
          },
        });
        this.emitter.emitAiCompleted({
          ...telemetry,
          invocationId,
          stageName: PIPELINE_STAGES.LLM_REQUEST,
          status: 'success',
          responseHash: hashPayload(responseText),
          responsePayload: parsed,
          inputTokens,
          outputTokens,
          totalTokens,
          durationMs: latencyMs,
        });
      }

      this.circuitBreaker.recordSuccess();
      await this.aiUsageService.record({
        stage: FLASHCARD_CONTENT_STAGE,
        provider: 'google-gemini',
        model: this.modelName,
        requestId,
        startedAt,
        completedAt: new Date(),
        latencyMs,
        inputTokens:
          usage?.promptTokenCount ?? usage?.inputTokenCount ?? undefined,
        outputTokens:
          usage?.candidatesTokenCount ?? usage?.outputTokenCount ?? undefined,
        totalTokens: usage?.totalTokenCount ?? undefined,
        status: 'success',
        retryCount,
      });

      return payload;
    } catch (error) {
      this.circuitBreaker.recordFailure();
      await this.aiUsageService.record({
        stage: FLASHCARD_CONTENT_STAGE,
        provider: 'google-gemini',
        model: this.modelName,
        startedAt,
        completedAt: new Date(),
        latencyMs: latencyMs || Date.now() - startedAt.getTime(),
        status: 'failed',
        retryCount,
        errorType: getErrorMessage(error),
      });

      if (telemetry) {
        this.emitter.emitAiCompleted({
          ...telemetry,
          invocationId,
          stageName: PIPELINE_STAGES.LLM_REQUEST,
          status: 'failed',
          errorMessage: getErrorMessage(error),
          durationMs: latencyMs || Date.now() - startedAt.getTime(),
        });
        this.emitter.emitStageFailed({
          ...telemetry,
          stageName: PIPELINE_STAGES.LLM_REQUEST,
          errorMessage: getErrorMessage(error),
          retryCount,
        });
      }

      if (error instanceof FlashcardException) {
        throw error;
      }

      const message = getErrorMessage(error);
      if (/timeout/i.test(message)) {
        throw new FlashcardException(
          'LLM_TIMEOUT',
          'Flashcard content generation timed out',
          HttpStatus.GATEWAY_TIMEOUT,
          { cause: message },
        );
      }

      throw new FlashcardException(
        'INVALID_LLM_OUTPUT',
        `Flashcard content generation failed: ${message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Accept a full valid payload, or repair individual invalid cards without
   * regenerating the entire set.
   */
  private async validateOrRepairCards(
    parsed: unknown,
    input: GenerateContentInput,
    telemetry: PipelineTelemetryContext | undefined,
    retryCount: number,
  ): Promise<LlmFlashcardPayload> {
    try {
      return validateLlmFlashcardPayload(
        parsed,
        input.count,
        input.textComponents,
      );
    } catch (error) {
      if (input.count <= 1) {
        throw error;
      }

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !Array.isArray((parsed as { cards?: unknown }).cards)
      ) {
        throw error;
      }

      const rawCards = (parsed as { cards: unknown[] }).cards;
      if (rawCards.length !== input.count) {
        throw error;
      }

      this.logger.warn(
        `Full payload validation failed (${getErrorMessage(error)}); repairing individual cards`,
      );

      const cards: LlmFlashcardPayload['cards'] = [];
      for (let index = 0; index < rawCards.length; index += 1) {
        try {
          cards.push(
            validateLlmCardContent(
              rawCards[index],
              index,
              input.textComponents,
            ),
          );
        } catch (cardError) {
          const reason = getErrorMessage(cardError);
          this.logger.warn(
            `Regenerating card ${index} only (retry ${retryCount}): ${reason}`,
          );
          cards.push(
            await this.regenerateCard(
              {
                query: input.query,
                topic: input.topic,
                ageMin: input.ageMin,
                ageMax: input.ageMax,
                learningObjective: input.learningObjective,
                textComponents: input.textComponents,
                grade: input.grade,
                subject: input.subject,
                difficulty: input.difficulty,
                language: input.language,
              },
              index,
              reason,
              telemetry,
            ),
          );
        }
      }

      return { cards };
    }
  }
}

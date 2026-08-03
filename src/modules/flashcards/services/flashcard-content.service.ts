import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { getErrorMessage } from '../../../common/utils/error-message';
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
import { validateLlmFlashcardPayload } from '../utils/llm-content.validator';
import { HttpStatus } from '@nestjs/common';

export interface GenerateContentInput {
  query: string;
  topic: string;
  ageMin: number;
  ageMax: number;
  learningObjective: string;
  count: number;
  textComponents: TemplateComponentDefinition[];
}

@Injectable()
export class FlashcardContentService {
  private readonly logger = new Logger(FlashcardContentService.name);
  private client: GoogleGenAI | null;
  private readonly modelName: string;
  private readonly promptVersion: string;
  private readonly rateLimiter: RateLimiter;
  private readonly circuitBreaker: CircuitBreaker;

  constructor(
    private readonly configService: ConfigService,
    private readonly aiUsageService: AiUsageService,
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
  ): Promise<LlmFlashcardPayload> {
    try {
      return await this.requestContent(input);
    } catch (error) {
      if (
        !(error instanceof FlashcardException) ||
        error.code !== 'INVALID_LLM_OUTPUT'
      ) {
        throw error;
      }

      this.logger.warn(
        `Retrying flashcard content generation after invalid output: ${getErrorMessage(error)}`,
      );
      return this.requestContent(input, getErrorMessage(error));
    }
  }

  private async requestContent(
    input: GenerateContentInput,
    correction?: string,
  ): Promise<LlmFlashcardPayload> {
    if (!this.client) {
      throw new FlashcardException(
        'RETRY_EXHAUSTION',
        'Gemini content client is not initialized',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const basePrompt = buildFlashcardContentPrompt(input);
    const prompt = correction
      ? `${basePrompt}\n\nYour previous response was rejected: ${correction}\nReturn corrected JSON using the exact component keys listed above.`
      : basePrompt;
    const startedAt = new Date();
    let latencyMs = 0;

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

      const payload = validateLlmFlashcardPayload(
        parsed,
        input.count,
        input.textComponents,
      );

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
        errorType: getErrorMessage(error),
      });

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
}

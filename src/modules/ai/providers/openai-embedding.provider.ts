import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  EmbeddingBillingScope,
  EmbeddingCallOptions,
  EmbeddingProvider,
  EmbeddingResult,
} from '../../../common/interfaces/embedding-provider.interface';
import {
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  OPENAI_EMBEDDING_DIMENSIONS,
} from '../constants/embedding.constants';
import { hashSourceText } from '../utils/source-text-hash.util';
import { CircuitBreaker } from '../utils/circuit-breaker.util';
import { RateLimiter } from '../utils/rate-limiter.util';

export interface OpenAiUsageMetrics {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  requestId?: string;
  latencyMs: number;
}

@Injectable()
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = 'openai';
  readonly modelName: string;
  readonly dimensions = OPENAI_EMBEDDING_DIMENSIONS;

  private readonly logger = new Logger(OpenAiEmbeddingProvider.name);
  private readonly clients = new Map<EmbeddingBillingScope, OpenAI>();
  private readonly rateLimiter: RateLimiter;
  private readonly circuitBreaker: CircuitBreaker;
  private lastUsage: OpenAiUsageMetrics | null = null;

  constructor(private readonly configService: ConfigService) {
    this.modelName =
      this.configService.get<string>('ai.openaiEmbeddingModel') ||
      DEFAULT_OPENAI_EMBEDDING_MODEL;

    const maxRps = this.configService.get<number>('ai.openaiMaxRps') ?? 10;
    const failureThreshold =
      this.configService.get<number>('ai.circuitFailureThreshold') ?? 5;
    const cooldownMs =
      this.configService.get<number>('ai.circuitCooldownMs') ?? 60000;

    this.rateLimiter = new RateLimiter(maxRps);
    this.circuitBreaker = new CircuitBreaker(
      this.providerName,
      failureThreshold,
      cooldownMs,
    );

    for (const scope of ['platform', 'flashcards', 'worksheets'] as const) {
      const apiKey = this.resolveApiKey(scope);
      if (apiKey) {
        this.clients.set(scope, new OpenAI({ apiKey }));
      }
    }

    if (this.clients.size === 0) {
      this.logger.warn(
        'No OpenAI API keys configured for embeddings (OPENAI_API_KEY / FLASHCARD_OPENAI_API_KEY / WORKSHEET_OPENAI_API_KEY).',
      );
    } else {
      this.logger.log(
        `OpenAI embedding provider initialized with model ${this.modelName}; scopes=[${[...this.clients.keys()].join(', ')}]`,
      );
    }
  }

  /** Test helper — replaces the platform client (and any missing scopes). */
  public setClient(client: OpenAI): void {
    this.clients.set('platform', client);
    if (!this.clients.has('flashcards')) {
      this.clients.set('flashcards', client);
    }
    if (!this.clients.has('worksheets')) {
      this.clients.set('worksheets', client);
    }
  }

  public getLastUsage(): OpenAiUsageMetrics | null {
    return this.lastUsage;
  }

  public async generateEmbedding(
    text: string,
    options?: EmbeddingCallOptions,
  ): Promise<EmbeddingResult> {
    const [result] = await this.generateEmbeddings([text], options);
    return result;
  }

  public async generateEmbeddings(
    texts: string[],
    options?: EmbeddingCallOptions,
  ): Promise<EmbeddingResult[]> {
    const scope: EmbeddingBillingScope = options?.billingScope ?? 'platform';
    const client = this.clients.get(scope);
    if (!client) {
      throw new Error(
        `OpenAI embedding client is not initialized for billing scope "${scope}"`,
      );
    }

    const normalized = texts.map((text) => text.trim());
    if (normalized.some((text) => !text)) {
      throw new Error('Embedding input text cannot be empty');
    }
    if (normalized.length === 0) {
      return [];
    }

    this.circuitBreaker.beforeRequest();
    await this.rateLimiter.acquire();

    const startedAt = Date.now();

    try {
      const response = await client.embeddings.create({
        model: this.modelName,
        input: normalized.length === 1 ? normalized[0] : normalized,
      });

      const latencyMs = Date.now() - startedAt;
      this.lastUsage = {
        latencyMs,
        inputTokens: response.usage?.prompt_tokens,
        totalTokens: response.usage?.total_tokens,
        requestId: response._request_id ?? undefined,
      };

      const byIndex = new Map(
        response.data.map((item) => [item.index, item.embedding]),
      );
      const results: EmbeddingResult[] = [];

      for (let i = 0; i < normalized.length; i += 1) {
        const embedding = byIndex.get(i) ?? response.data[i]?.embedding;
        if (!embedding) {
          throw new Error('OpenAI embedding response did not contain vector data');
        }
        if (embedding.length !== this.dimensions) {
          throw new Error(
            `Expected ${this.dimensions}-dim embedding, received ${embedding.length}`,
          );
        }
        results.push({
          embedding,
          dimensions: embedding.length,
          provider: this.providerName,
          model: this.modelName,
          sourceTextHash: hashSourceText(normalized[i]),
        });
      }

      this.circuitBreaker.recordSuccess();
      return results;
    } catch (error) {
      this.lastUsage = {
        latencyMs: Date.now() - startedAt,
      };
      this.circuitBreaker.recordFailure();
      throw error;
    }
  }

  private resolveApiKey(scope: EmbeddingBillingScope): string | undefined {
    switch (scope) {
      case 'flashcards':
        return this.configService.get<string>('flashcards.openaiApiKey');
      case 'worksheets':
        return this.configService.get<string>('worksheets.openaiApiKey');
      case 'platform':
      default:
        return this.configService.get<string>('ai.openaiApiKey');
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import {
  VisionAnalysisResult,
  VisionMetadataDto,
} from '../../../common/dto/vision-metadata.dto';
import {
  VisionProvider,
  VisionProviderInput,
} from '../../../common/interfaces/vision-provider.interface';
import {
  DEFAULT_GEMINI_VISION_MODEL,
  DEFAULT_VISION_PROMPT_VERSION,
  buildVisionAnalysisPrompt,
  VISION_METADATA_JSON_SCHEMA,
} from '../constants/vision-prompt.constants';
import { buildSearchDescription } from '../utils/search-description.builder';
import { parseVisionMetadata } from '../utils/vision-metadata.parser';
import { CircuitBreaker } from '../utils/circuit-breaker.util';
import { RateLimiter } from '../utils/rate-limiter.util';

export interface GeminiUsageMetrics {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  requestId?: string;
  latencyMs: number;
}

@Injectable()
export class GeminiVisionProvider implements VisionProvider {
  readonly providerName = 'google-gemini';
  readonly modelName: string;
  readonly modelVersion: string;

  private readonly logger = new Logger(GeminiVisionProvider.name);
  private client: GoogleGenAI | null;
  private readonly defaultPromptVersion: string;
  private readonly rateLimiter: RateLimiter;
  private readonly circuitBreaker: CircuitBreaker;
  private lastUsage: GeminiUsageMetrics | null = null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('ai.geminiApiKey');
    this.modelName =
      this.configService.get<string>('ai.geminiModel') ||
      DEFAULT_GEMINI_VISION_MODEL;
    this.modelVersion = this.modelName;
    this.defaultPromptVersion =
      this.configService.get<string>('ai.geminiPromptVersion') ||
      DEFAULT_VISION_PROMPT_VERSION;

    const maxRps = this.configService.get<number>('ai.geminiMaxRps') ?? 2;
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

    if (apiKey) {
      this.client = new GoogleGenAI({ apiKey });
      this.logger.log(
        `Gemini vision provider initialized with model ${this.modelName}`,
      );
    } else {
      this.client = null;
      this.logger.warn(
        'GEMINI_API_KEY not provided. GeminiVisionProvider is unavailable.',
      );
    }
  }

  public setClient(client: GoogleGenAI): void {
    this.client = client;
  }

  public getLastUsage(): GeminiUsageMetrics | null {
    return this.lastUsage;
  }

  public async analyzeImage(
    input: VisionProviderInput,
  ): Promise<VisionAnalysisResult> {
    if (!this.client) {
      throw new Error('Gemini vision client is not initialized');
    }

    this.circuitBreaker.beforeRequest();
    await this.rateLimiter.acquire();

    const promptVersion = input.promptVersion || this.defaultPromptVersion;
    const base64Image = input.imageBuffer.toString('base64');
    const startedAt = Date.now();

    try {
      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: [
          {
            role: 'user',
            parts: [
              { text: buildVisionAnalysisPrompt(input.filename) },
              {
                inlineData: {
                  mimeType: input.mimeType,
                  data: base64Image,
                },
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: VISION_METADATA_JSON_SCHEMA,
        },
      });

      const latencyMs = Date.now() - startedAt;
      const usage = (response as { usageMetadata?: Record<string, number> })
        .usageMetadata;
      this.lastUsage = {
        latencyMs,
        inputTokens:
          usage?.promptTokenCount ?? usage?.inputTokenCount ?? undefined,
        outputTokens:
          usage?.candidatesTokenCount ?? usage?.outputTokenCount ?? undefined,
        totalTokens: usage?.totalTokenCount ?? undefined,
        requestId: (response as { responseId?: string }).responseId,
      };

      const responseText = response.text?.trim();
      if (!responseText) {
        throw new Error('Gemini vision response did not contain JSON metadata');
      }

      let parsedResponse: unknown;
      try {
        parsedResponse = JSON.parse(responseText);
      } catch {
        throw new Error('Gemini vision response was not valid JSON');
      }

      const metadata = parseVisionMetadata(parsedResponse);
      const searchDescription = buildSearchDescription(metadata);

      this.circuitBreaker.recordSuccess();

      return {
        metadata,
        searchDescription,
        rawResponse: parsedResponse as Record<string, unknown>,
        provider: this.providerName,
        model: this.modelName,
        modelVersion: this.modelVersion,
        promptVersion,
      };
    } catch (error) {
      this.lastUsage = {
        latencyMs: Date.now() - startedAt,
      };
      this.circuitBreaker.recordFailure();
      throw error;
    }
  }

  public buildSearchDescription(metadata: VisionMetadataDto): string {
    return buildSearchDescription(metadata);
  }
}

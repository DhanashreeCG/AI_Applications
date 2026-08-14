import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { AiUsageService } from '../../ai/services/ai-usage.service';
import { CircuitBreaker } from '../../ai/utils/circuit-breaker.util';
import { RateLimiter } from '../../ai/utils/rate-limiter.util';
import { getErrorMessage } from '../../../common/utils/error-message';
import {
  WORKSHEET_CONTENT_STAGE,
  WORKSHEET_EDIT_STAGE,
} from '../constants/worksheet.constants';
import {
  buildWorksheetContentPrompt,
  buildWorksheetEditPrompt,
} from '../constants/worksheet-prompt.constants';
import { WorksheetException } from '../errors/worksheet.exception';
import { GenerateWorksheetRequest } from '../types/worksheet.types';
import { WorksheetTemplateRecord } from './worksheet-template.service';
import { WorksheetValidationService } from './worksheet-validation.service';

@Injectable()
export class WorksheetContentService {
  private readonly logger = new Logger(WorksheetContentService.name);
  private client: GoogleGenAI | null;
  private readonly modelName: string;
  private readonly rateLimiter: RateLimiter;
  private readonly circuitBreaker: CircuitBreaker;

  constructor(
    private readonly configService: ConfigService,
    private readonly aiUsageService: AiUsageService,
    private readonly validationService: WorksheetValidationService,
  ) {
    const apiKey = this.configService.get<string>('ai.geminiApiKey');
    this.modelName =
      this.configService.get<string>('worksheets.geminiModel') ||
      'gemini-2.5-flash';
    this.rateLimiter = new RateLimiter(
      this.configService.get<number>('ai.geminiMaxRps') ?? 2,
    );
    this.circuitBreaker = new CircuitBreaker(
      'google-gemini-worksheet-content',
      this.configService.get<number>('ai.circuitFailureThreshold') ?? 5,
      this.configService.get<number>('ai.circuitCooldownMs') ?? 60000,
    );
    this.client = apiKey ? new GoogleGenAI({ apiKey }) : null;
    if (!apiKey) {
      this.logger.warn(
        'GEMINI_API_KEY not provided. WorksheetContentService is unavailable.',
      );
    }
  }

  public setClient(client: GoogleGenAI): void {
    this.client = client;
  }

  public async generateStructure(
    template: WorksheetTemplateRecord,
    request: GenerateWorksheetRequest,
  ): Promise<Record<string, unknown>> {
    const prompt = buildWorksheetContentPrompt({
      request,
      templateName: template.name,
      templateSlug: template.slug,
      templateDescription: template.description,
      structureDefinition: template.structureDefinition,
      meta: template.meta,
    });
    const parsed = await this.generateJson(prompt, WORKSHEET_CONTENT_STAGE);
    return this.validationService.validateGeneratedStructure(parsed, template);
  }

  public async generateFieldReplacement(input: {
    systemPrompt?: string | null;
    fieldPath: string;
    fieldPrompt?: string | null;
    instruction: string;
    currentValue: unknown;
    worksheetStructure: unknown;
    linkedValues: Record<string, unknown>;
  }): Promise<unknown> {
    const prompt = buildWorksheetEditPrompt(input);
    const parsed = await this.generateJson(prompt, WORKSHEET_EDIT_STAGE);
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.prototype.hasOwnProperty.call(parsed, 'value')
    ) {
      return (parsed as { value: unknown }).value;
    }
    return parsed;
  }

  private async generateJson(
    prompt: string,
    stage: string,
  ): Promise<unknown> {
    if (!this.client) {
      throw new WorksheetException(
        'CONTENT_CLIENT_UNAVAILABLE',
        'Gemini content client is not initialized',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    this.circuitBreaker.beforeRequest();
    await this.rateLimiter.acquire();
    const startedAt = new Date();

    try {
      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
        },
      });
      const text = response.text?.trim();
      const latencyMs = Date.now() - startedAt.getTime();
      const usage = (
        response as { usageMetadata?: Record<string, number> }
      ).usageMetadata;

      await this.aiUsageService.record({
        stage,
        provider: 'google-gemini',
        model: this.modelName,
        requestId: (response as { responseId?: string }).responseId,
        startedAt,
        completedAt: new Date(),
        latencyMs,
        inputTokens: usage?.promptTokenCount,
        outputTokens: usage?.candidatesTokenCount,
        totalTokens: usage?.totalTokenCount,
        status: 'success',
      });
      this.circuitBreaker.recordSuccess();

      if (!text) {
        throw new WorksheetException(
          'INVALID_LLM_OUTPUT',
          'Gemini returned an empty worksheet response',
        );
      }

      try {
        return JSON.parse(text);
      } catch {
        throw new WorksheetException(
          'INVALID_LLM_OUTPUT',
          'Gemini worksheet response was not valid JSON',
        );
      }
    } catch (error) {
      if (!(error instanceof WorksheetException)) {
        this.circuitBreaker.recordFailure();
        await this.aiUsageService.record({
          stage,
          provider: 'google-gemini',
          model: this.modelName,
          startedAt,
          completedAt: new Date(),
          latencyMs: Date.now() - startedAt.getTime(),
          status: 'failed',
          errorType: getErrorMessage(error),
        });
      }
      if (error instanceof WorksheetException) {
        throw error;
      }
      throw new WorksheetException(
        'INVALID_LLM_OUTPUT',
        'Worksheet content generation failed',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}

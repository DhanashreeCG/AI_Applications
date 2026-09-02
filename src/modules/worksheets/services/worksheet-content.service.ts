import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'node:crypto';
import { AiUsageService } from '../../ai/services/ai-usage.service';
import { CircuitBreaker } from '../../ai/utils/circuit-breaker.util';
import { RateLimiter } from '../../ai/utils/rate-limiter.util';
import { getErrorMessage } from '../../../common/utils/error-message';
import {
  PIPELINE_STAGES,
  PipelineTelemetryContext,
} from '../../../common/events/pipeline-tracker.events';
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
import {
  WorksheetPipelineEmitter,
  hashPayload,
  maybeRunTrackedStage,
} from '../telemetry/worksheet-pipeline.events';
import { WorksheetTemplateRecord } from './worksheet-template.service';
import { WorksheetValidationService } from './worksheet-validation.service';
import { normalizeLlmWorksheetPayload } from '../utils/structure.util';

@Injectable()
export class WorksheetContentService {
  private readonly logger = new Logger(WorksheetContentService.name);
  private client: GoogleGenAI | null;
  private readonly modelName: string;
  private readonly rateLimiter: RateLimiter;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly emitter: WorksheetPipelineEmitter;

  constructor(
    private readonly configService: ConfigService,
    private readonly aiUsageService: AiUsageService,
    private readonly validationService: WorksheetValidationService,
    eventEmitter: EventEmitter2,
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
    this.emitter = new WorksheetPipelineEmitter(eventEmitter);
    if (!apiKey) {
      this.logger.warn(
        'GEMINI_API_KEY not provided. WorksheetContentService is unavailable.',
      );
    }
  }

  public setClient(client: GoogleGenAI): void {
    this.client = client;
  }

  public async generateStructures(
    template: WorksheetTemplateRecord,
    request: GenerateWorksheetRequest,
    count: number = 1,
    telemetry?: PipelineTelemetryContext,
    extras?: {
      currentStructure?: Record<string, unknown> | null;
      systemPrompt?: string | null;
    },
  ): Promise<Array<Record<string, unknown>>> {
    const targetCount = Math.max(1, count);
    const run = async () => {
      const prompt = await maybeRunTrackedStage(
        this.emitter,
        telemetry,
        PIPELINE_STAGES.PROMPT_GENERATION,
        () =>
          buildWorksheetContentPrompt({
            request,
            templateName: template.name,
            templateSlug: template.slug,
            templateDescription: template.description,
            structureDefinition: template.structureDefinition,
            meta: template.meta,
            count: targetCount,
            systemPrompt: extras?.systemPrompt,
            currentStructure: extras?.currentStructure,
          }),
        {
          completeMetadata: {
            templateId: template.id,
            templateSlug: template.slug,
            count: targetCount,
          },
        },
      );

      const parsed = await this.generateJson(
        prompt,
        WORKSHEET_CONTENT_STAGE,
        telemetry,
      );

      let rawItems = normalizeLlmWorksheetPayload(parsed, targetCount);

      if (!rawItems.length) {
        throw new WorksheetException(
          'INVALID_LLM_OUTPUT',
          'LLM failed to produce worksheet structure contents',
          HttpStatus.BAD_GATEWAY,
        );
      }

      return maybeRunTrackedStage(
        this.emitter,
        telemetry,
        PIPELINE_STAGES.CONTENT_VALIDATION,
        () => {
          const validatedItems: Array<Record<string, unknown>> = [];
          for (const rawItem of rawItems) {
            try {
              const validated = this.validationService.validateGeneratedStructure(
                rawItem,
                template,
                { allowEnrichmentKeys: true },
              );
              validatedItems.push(validated);
            } catch (err) {
              this.logger.warn(
                `validation skipped invalid worksheet item in batch: ${getErrorMessage(err)}`,
              );
            }
          }

          if (!validatedItems.length) {
            throw new WorksheetException(
              'INVALID_STRUCTURE',
              'None of the generated worksheet structures passed validation',
              HttpStatus.BAD_GATEWAY,
            );
          }

          return validatedItems;
        },
        {
          completeMetadata: (items) => ({
            templateId: template.id,
            templateSlug: template.slug,
            count: items.length,
          }),
        },
      );
    };

    return maybeRunTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.LLM_CONTENT_GENERATION,
      run,
      {
        startMetadata: {
          templateId: template.id,
          templateSlug: template.slug,
          count: targetCount,
        },
        completeMetadata: (items) => ({
          templateId: template.id,
          templateSlug: template.slug,
          generatedCount: items.length,
        }),
      },
    );
  }

  public async generateStructure(
    template: WorksheetTemplateRecord,
    request: GenerateWorksheetRequest,
    telemetry?: PipelineTelemetryContext,
    extras?: {
      currentStructure?: Record<string, unknown> | null;
      systemPrompt?: string | null;
    },
  ): Promise<Record<string, unknown>> {
    const items = await this.generateStructures(
      template,
      request,
      1,
      telemetry,
      extras,
    );
    return items[0];
  }

  public async generateFieldReplacement(input: {
    systemPrompt?: string | null;
    fieldPath: string;
    fieldPrompt?: string | null;
    instruction: string;
    currentValue: unknown;
    worksheetStructure: unknown;
    linkedValues: Record<string, unknown>;
    countryCode?: string | null;
    telemetry?: PipelineTelemetryContext;
  }): Promise<unknown> {
    const telemetry = input.telemetry;
    const run = async () => {
      const prompt = await maybeRunTrackedStage(
        this.emitter,
        telemetry,
        PIPELINE_STAGES.PROMPT_GENERATION,
        () =>
          buildWorksheetEditPrompt({
            systemPrompt: input.systemPrompt,
            fieldPath: input.fieldPath,
            fieldPrompt: input.fieldPrompt,
            instruction: input.instruction,
            currentValue: input.currentValue,
            worksheetStructure: input.worksheetStructure,
            linkedValues: input.linkedValues,
            countryCode: input.countryCode,
          }),
        {
          completeMetadata: { fieldPath: input.fieldPath },
        },
      );
      const parsed = await this.generateJson(
        prompt,
        WORKSHEET_EDIT_STAGE,
        telemetry,
      );
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        Object.prototype.hasOwnProperty.call(parsed, 'value')
      ) {
        return (parsed as { value: unknown }).value;
      }
      return parsed;
    };

    return maybeRunTrackedStage(
      this.emitter,
      telemetry,
      PIPELINE_STAGES.LLM_CONTENT_GENERATION,
      run,
      {
        startMetadata: { fieldPath: input.fieldPath },
        completeMetadata: { fieldPath: input.fieldPath },
      },
    );
  }

  private async generateJson(
    prompt: string,
    stage: string,
    telemetry?: PipelineTelemetryContext,
  ): Promise<unknown> {
    if (!this.client) {
      throw new WorksheetException(
        'CONTENT_CLIENT_UNAVAILABLE',
        'Gemini content client is not initialized',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const invocationId = randomUUID();
    if (telemetry) {
      this.emitter.emitStageStarted({
        ...telemetry,
        stageName: PIPELINE_STAGES.LLM_REQUEST,
        metadata: { purpose: stage },
      });
      this.emitter.emitAiStarted({
        ...telemetry,
        invocationId,
        stageName: PIPELINE_STAGES.LLM_REQUEST,
        provider: 'google-gemini',
        model: this.modelName,
        purpose: stage,
        promptHash: hashPayload(prompt),
        promptPayload: prompt,
      });
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
      const inputTokens = usage?.promptTokenCount;
      const outputTokens = usage?.candidatesTokenCount;
      const totalTokens = usage?.totalTokenCount;

      await this.aiUsageService.record({
        stage,
        provider: 'google-gemini',
        model: this.modelName,
        requestId: (response as { responseId?: string }).responseId,
        startedAt,
        completedAt: new Date(),
        latencyMs,
        inputTokens,
        outputTokens,
        totalTokens,
        status: 'success',
      });
      this.circuitBreaker.recordSuccess();

      if (!text) {
        throw new WorksheetException(
          'INVALID_LLM_OUTPUT',
          'Gemini returned an empty worksheet response',
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new WorksheetException(
          'INVALID_LLM_OUTPUT',
          'Gemini worksheet response was not valid JSON',
        );
      }

      if (telemetry) {
        this.emitter.emitAiCompleted({
          ...telemetry,
          invocationId,
          stageName: PIPELINE_STAGES.LLM_REQUEST,
          status: 'success',
          responseHash: hashPayload(text),
          responsePayload: parsed,
          inputTokens,
          outputTokens,
          totalTokens,
          durationMs: latencyMs,
        });
        this.emitter.emitStageCompleted({
          ...telemetry,
          stageName: PIPELINE_STAGES.LLM_REQUEST,
          metadata: {
            purpose: stage,
            inputTokens,
            outputTokens,
            totalTokens,
            durationMs: latencyMs,
          },
        });
      }

      return parsed;
    } catch (error) {
      if (telemetry) {
        this.emitter.emitAiCompleted({
          ...telemetry,
          invocationId,
          stageName: PIPELINE_STAGES.LLM_REQUEST,
          status: 'failed',
          errorMessage: getErrorMessage(error),
          durationMs: Date.now() - startedAt.getTime(),
        });
        this.emitter.emitStageFailed({
          ...telemetry,
          stageName: PIPELINE_STAGES.LLM_REQUEST,
          errorMessage: getErrorMessage(error),
        });
      }
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

import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
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
  buildWorksheetGrammarPrompt,
} from '../constants/worksheet-prompt.constants';
import { WorksheetException } from '../errors/worksheet.exception';
import { GenerateWorksheetRequest, WorksheetAiConfig } from '../types/worksheet.types';
import {
  WorksheetPipelineEmitter,
  hashPayload,
  maybeRunTrackedStage,
} from '../telemetry/worksheet-pipeline.events';
import { WorksheetTemplateRecord } from './worksheet-template.service';
import { WorksheetValidationService } from './worksheet-validation.service';
import { normalizeLlmWorksheetPayload, parseJsonObject } from '../utils/structure.util';
import { normalizeNumberNamesPairs } from '../utils/number-match.util';
import {
  resolveUniversalContentRoute,
  type UniversalContentRoute,
} from '../utils/universal-content-ai.util';

type ContentRoute = UniversalContentRoute;

function readContentRegion(
  rendererConfig: unknown,
): { width?: number; height?: number; left?: number; top?: number } | null {
  const cfg = parseJsonObject(rendererConfig);
  const region = parseJsonObject(cfg?.contentRegion);
  if (!region) return null;
  return {
    left: typeof region.left === 'number' ? region.left : undefined,
    top: typeof region.top === 'number' ? region.top : undefined,
    width: typeof region.width === 'number' ? region.width : undefined,
    height: typeof region.height === 'number' ? region.height : undefined,
  };
}

function providerLabel(provider: ContentRoute['provider']): string {
  return provider === 'openai' ? 'openai' : 'google-gemini';
}

@Injectable()
export class WorksheetContentService {
  private readonly logger = new Logger(WorksheetContentService.name);
  private client: GoogleGenAI | null;
  private openaiClient: OpenAI | null;
  private readonly geminiModelName: string;
  private readonly geminiRateLimiter: RateLimiter;
  private readonly openaiRateLimiter: RateLimiter;
  private readonly geminiCircuitBreaker: CircuitBreaker;
  private readonly openaiCircuitBreaker: CircuitBreaker;
  private readonly emitter: WorksheetPipelineEmitter;

  constructor(
    private readonly configService: ConfigService,
    private readonly aiUsageService: AiUsageService,
    private readonly validationService: WorksheetValidationService,
    eventEmitter: EventEmitter2,
  ) {
    const geminiApiKey = this.configService.get<string>('worksheets.geminiApiKey');
    const openaiApiKey = this.configService.get<string>('worksheets.openaiApiKey');
    this.geminiModelName =
      this.configService.get<string>('worksheets.geminiModel') ||
      'gemini-2.5-flash';

    const failureThreshold =
      this.configService.get<number>('ai.circuitFailureThreshold') ?? 5;
    const cooldownMs =
      this.configService.get<number>('ai.circuitCooldownMs') ?? 60000;

    this.geminiRateLimiter = new RateLimiter(
      this.configService.get<number>('ai.geminiMaxRps') ?? 2,
    );
    this.openaiRateLimiter = new RateLimiter(
      this.configService.get<number>('ai.openaiMaxRps') ?? 10,
    );
    this.geminiCircuitBreaker = new CircuitBreaker(
      'google-gemini-worksheet-content',
      failureThreshold,
      cooldownMs,
    );
    this.openaiCircuitBreaker = new CircuitBreaker(
      'openai-worksheet-content',
      failureThreshold,
      cooldownMs,
    );

    this.client = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;
    this.openaiClient = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;
    this.emitter = new WorksheetPipelineEmitter(eventEmitter);

    if (!geminiApiKey) {
      this.logger.warn(
        'WORKSHEET_GEMINI_API_KEY (or GEMINI_API_KEY fallback) not provided. Gemini worksheet content is unavailable.',
      );
    }
    if (!openaiApiKey) {
      this.logger.warn(
        'WORKSHEET_OPENAI_API_KEY (or OPENAI_API_KEY fallback) not provided. OpenAI worksheet content (universal) is unavailable.',
      );
    }
  }

  public setClient(client: GoogleGenAI): void {
    this.client = client;
  }

  public setOpenAiClient(client: OpenAI): void {
    this.openaiClient = client;
  }

  public async generateStructures(
    template: WorksheetTemplateRecord,
    request: GenerateWorksheetRequest,
    count: number = 1,
    telemetry?: PipelineTelemetryContext,
    extras?: {
      currentStructure?: Record<string, unknown> | null;
      systemPrompt?: string | null;
      stage?: string;
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
            adaptationNote: template.selectionProfile?.adaptationNote ?? null,
            contentRegion: readContentRegion(template.rendererConfig),
          }),
        {
          completeMetadata: {
            templateId: template.id,
            templateSlug: template.slug,
            count: targetCount,
          },
        },
      );

      const route = this.resolveContentRoute(template);
      if (
        route.provider !== 'gemini' ||
        route.model !== this.geminiModelName
      ) {
        this.logger.log(
          `using dedicated content route provider=${route.provider} model=${route.model} slug=${template.slug}`,
        );
      }
      const parsed = await this.generateJson(
        prompt,
        extras?.stage || WORKSHEET_CONTENT_STAGE,
        telemetry,
        route,
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
              const normalized =
                template.slug === 'number_names'
                  ? normalizeNumberNamesPairs(validated, {
                      range: request.fields?.range,
                      specificNumbers: request.fields?.specificNumbers,
                      query: request.query,
                      matchType: request.fields?.matchType,
                    })
                  : validated;
              validatedItems.push(normalized);
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
      stage?: string;
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

  public async correctLearnerGrammar(
    structure: Record<string, unknown>,
    telemetry?: PipelineTelemetryContext,
  ): Promise<Record<string, unknown>> {
    const parsed = await this.generateJson(
      buildWorksheetGrammarPrompt({ structure }),
      WORKSHEET_EDIT_STAGE,
      telemetry,
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return structure;
    }
    const next = { ...structure };
    const incoming = (parsed as { questions?: unknown }).questions;
    if (Array.isArray(incoming) && Array.isArray(next.questions)) {
      next.questions = (next.questions as Array<Record<string, unknown>>).map(
        (current, index) => {
          const updated = incoming[index];
          if (!updated || typeof updated !== 'object' || Array.isArray(updated)) {
            return current;
          }
          const record = updated as Record<string, unknown>;
          const merged: Record<string, unknown> = { ...current };
          if (typeof record.question === 'string') {
            merged.question = record.question;
          }
          if (Array.isArray(record.options) && Array.isArray(current.options)) {
            merged.options = (current.options as Array<Record<string, unknown>>).map(
              (option, optionIndex) => {
                const nextOption = record.options?.[optionIndex];
                if (
                  nextOption &&
                  typeof nextOption === 'object' &&
                  !Array.isArray(nextOption) &&
                  typeof (nextOption as { text?: unknown }).text === 'string'
                ) {
                  return { ...option, text: (nextOption as { text: string }).text };
                }
                return option;
              },
            );
          }
          return merged;
        },
      );
    }
    return next;
  }

  private async generateJson(
    prompt: string,
    stage: string,
    telemetry?: PipelineTelemetryContext,
    routeOverride?: ContentRoute | null,
  ): Promise<unknown> {
    const route: ContentRoute = routeOverride ?? {
      provider: 'gemini',
      model: this.geminiModelName,
    };
    const providerName = providerLabel(route.provider);

    if (route.provider === 'openai' && !this.openaiClient) {
      throw new WorksheetException(
        'CONTENT_CLIENT_UNAVAILABLE',
        'OpenAI content client is not initialized',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (route.provider === 'gemini' && !this.client) {
      throw new WorksheetException(
        'CONTENT_CLIENT_UNAVAILABLE',
        'Gemini content client is not initialized',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const circuit =
      route.provider === 'openai'
        ? this.openaiCircuitBreaker
        : this.geminiCircuitBreaker;
    const rateLimiter =
      route.provider === 'openai'
        ? this.openaiRateLimiter
        : this.geminiRateLimiter;

    const invocationId = randomUUID();
    if (telemetry) {
      this.emitter.emitStageStarted({
        ...telemetry,
        stageName: PIPELINE_STAGES.LLM_REQUEST,
        metadata: {
          purpose: stage,
          model: route.model,
          provider: providerName,
        },
      });
      this.emitter.emitAiStarted({
        ...telemetry,
        invocationId,
        stageName: PIPELINE_STAGES.LLM_REQUEST,
        provider: providerName,
        model: route.model,
        purpose: stage,
        promptHash: hashPayload(prompt),
        promptPayload: prompt,
      });
    }

    circuit.beforeRequest();
    await rateLimiter.acquire();
    const startedAt = new Date();

    try {
      let text = '';
      let requestId: string | undefined;
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let totalTokens: number | undefined;

      if (route.provider === 'openai') {
        const response = await this.openaiClient!.chat.completions.create({
          model: route.model,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
        });
        text = response.choices[0]?.message?.content?.trim() ?? '';
        requestId = response.id;
        inputTokens = response.usage?.prompt_tokens;
        outputTokens = response.usage?.completion_tokens;
        totalTokens = response.usage?.total_tokens;
      } else {
        const response = await this.client!.models.generateContent({
          model: route.model,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            responseMimeType: 'application/json',
          },
        });
        text = response.text?.trim() ?? '';
        const usage = (
          response as { usageMetadata?: Record<string, number> }
        ).usageMetadata;
        requestId = (response as { responseId?: string }).responseId;
        inputTokens = usage?.promptTokenCount;
        outputTokens = usage?.candidatesTokenCount;
        totalTokens = usage?.totalTokenCount;
      }

      const latencyMs = Date.now() - startedAt.getTime();

      await this.aiUsageService.record({
        stage,
        provider: providerName,
        model: route.model,
        requestId,
        startedAt,
        completedAt: new Date(),
        latencyMs,
        inputTokens,
        outputTokens,
        totalTokens,
        status: 'success',
      });
      circuit.recordSuccess();

      if (!text) {
        throw new WorksheetException(
          'INVALID_LLM_OUTPUT',
          `${route.provider === 'openai' ? 'OpenAI' : 'Gemini'} returned an empty worksheet response`,
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new WorksheetException(
          'INVALID_LLM_OUTPUT',
          `${route.provider === 'openai' ? 'OpenAI' : 'Gemini'} worksheet response was not valid JSON`,
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
            model: route.model,
            provider: providerName,
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
        circuit.recordFailure();
        await this.aiUsageService.record({
          stage,
          provider: providerName,
          model: route.model,
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

  /**
   * Non-universal templates always use worksheet Gemini.
   * Universal: WORKSHEET_UNIVERSAL_CONTENT_PROVIDER + matching model env.
   */
  private resolveContentRoute(template: WorksheetTemplateRecord): ContentRoute {
    const isUniversal =
      template.slug === 'universal_template' || template.slug === 'universal';
    if (!isUniversal) {
      return { provider: 'gemini', model: this.geminiModelName };
    }

    const allowDb =
      process.env.WORKSHEET_UNIVERSAL_ALLOW_DB_MODEL?.trim().toLowerCase() ===
      'true';
    const aiConfig = allowDb
      ? ((parseJsonObject(template.aiConfig) ?? {}) as WorksheetAiConfig & {
          contentProvider?: string;
        })
      : null;

    return resolveUniversalContentRoute({
      envProvider: process.env.WORKSHEET_UNIVERSAL_CONTENT_PROVIDER,
      configuredProvider: this.configService.get<string>(
        'worksheets.universalContentProvider',
      ),
      envGeminiModel: process.env.WORKSHEET_UNIVERSAL_GEMINI_MODEL,
      envOpenaiModel: process.env.WORKSHEET_UNIVERSAL_OPENAI_MODEL,
      configuredGeminiModel: this.configService.get<string>(
        'worksheets.universalGeminiModel',
      ),
      configuredOpenaiModel: this.configService.get<string>(
        'worksheets.universalOpenaiModel',
      ),
      fallbackGeminiModel: this.geminiModelName,
      fallbackOpenaiModel: 'gpt-4.1-mini',
      allowDbModel: allowDb,
      dbContentModel:
        typeof aiConfig?.contentModel === 'string'
          ? aiConfig.contentModel
          : null,
      dbContentProvider:
        typeof aiConfig?.contentProvider === 'string'
          ? aiConfig.contentProvider
          : null,
    });
  }
}

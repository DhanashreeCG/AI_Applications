import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { createHash, randomUUID } from 'node:crypto';
import { PIPELINE_STAGES } from '../../../common/events/pipeline-tracker.events';
import { getErrorMessage } from '../../../common/utils/error-message';
import { AiUsageService } from '../../ai/services/ai-usage.service';
import { CircuitBreaker } from '../../ai/utils/circuit-breaker.util';
import { RateLimiter } from '../../ai/utils/rate-limiter.util';
import {
  WORKSHEET_TEMPLATE_SELECTION_AI_PURPOSE,
  WORKSHEET_TEMPLATE_SELECTION_AI_STAGE,
  WORKSHEET_TEMPLATE_SELECTION_PROMPT_VERSION,
  WORKSHEET_TEMPLATE_SELECTION_RESPONSE_SCHEMA,
  WORKSHEET_TEMPLATE_SELECTION_SYSTEM_PROMPT,
  buildWorksheetTemplateSelectionGeminiSchema,
} from '../constants/worksheet-prompt.constants';
import {
  WorksheetTemplateSelectionAiFallbackReason,
  WorksheetTemplateSelectionAiOutcome,
  WorksheetTemplateSelectionAiResult,
  WorksheetTemplateSelectionAiSelectInput,
} from '../interfaces/worksheet-template-selection-ai.interfaces';
import { WorksheetPipelineEmitter, hashPayload } from '../telemetry/worksheet-pipeline.events';
import { WorksheetTemplateRecord, WorksheetTemplateService } from './worksheet-template.service';

interface ProviderUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

@Injectable()
export class WorksheetTemplateSelectionAiService {
  private readonly logger = new Logger(WorksheetTemplateSelectionAiService.name);
  private readonly enabled: boolean;
  private readonly provider: string;
  private readonly modelName: string;
  private readonly minConfidence: number;
  private readonly timeoutMs: number;
  private readonly costPerMInputUsd: number;
  private readonly costPerMCachedInputUsd: number;
  private readonly costPerMOutputUsd: number;
  private readonly rateLimiter: RateLimiter;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly emitter: WorksheetPipelineEmitter;
  private client: GoogleGenAI | null = null;
  private openaiClient: OpenAI | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly aiUsageService: AiUsageService,
    private readonly templateService: WorksheetTemplateService,
    eventEmitter: EventEmitter2,
  ) {
    this.enabled = this.configService.get<boolean>('worksheets.templateSelectionAi.enabled') !== false;
    this.provider = this.configService.get<string>('worksheets.templateSelectionAi.provider') || 'openai';
    this.modelName =
      this.provider === 'openai'
        ? (this.configService.get<string>('worksheets.templateSelectionAi.openaiModel') || 'gpt-4.1-mini')
        : (this.configService.get<string>('worksheets.templateSelectionAi.geminiModel') || 'gemini-2.5-flash');
    this.minConfidence = this.configService.get<number>('worksheets.templateSelectionAi.minConfidence') ?? 0.5;
    this.timeoutMs = this.configService.get<number>('worksheets.templateSelectionAi.timeoutMs') ?? 6000;
    this.costPerMInputUsd = this.configService.get<number>('worksheets.templateSelectionAi.costPerMInputUsd') ?? 0.4;
    this.costPerMCachedInputUsd =
      this.configService.get<number>('worksheets.templateSelectionAi.costPerMCachedInputUsd') ?? 0.1;
    this.costPerMOutputUsd = this.configService.get<number>('worksheets.templateSelectionAi.costPerMOutputUsd') ?? 1.6;

    const maxRps =
      this.provider === 'openai'
        ? (this.configService.get<number>('ai.openaiMaxRps') ?? 10)
        : (this.configService.get<number>('ai.geminiMaxRps') ?? 2);
    const failureThreshold = this.configService.get<number>('ai.circuitFailureThreshold') ?? 5;
    const cooldownMs = this.configService.get<number>('ai.circuitCooldownMs') ?? 60_000;

    this.rateLimiter = new RateLimiter(maxRps);
    this.circuitBreaker = new CircuitBreaker(
      `${this.provider}-worksheet-template-selection`,
      failureThreshold,
      cooldownMs,
    );
    this.emitter = new WorksheetPipelineEmitter(eventEmitter);

    const geminiApiKey = this.configService.get<string>('ai.geminiApiKey');
    const openaiApiKey = this.configService.get<string>('ai.openaiApiKey');
    this.client = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;
    this.openaiClient = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;

    if (this.enabled) {
      if (this.provider === 'openai' && !openaiApiKey) {
        this.logger.warn('OPENAI_API_KEY missing; worksheet AI selection will fall back to deterministic.');
      } else if (this.provider === 'gemini' && !geminiApiKey) {
        this.logger.warn('GEMINI_API_KEY missing; worksheet AI selection will fall back to deterministic.');
      }
    }
  }

  public async select(input: WorksheetTemplateSelectionAiSelectInput): Promise<WorksheetTemplateSelectionAiOutcome> {
    if (!this.enabled) {
      return this.fallback('disabled');
    }

    const allowed = [...new Set(input.allowedTemplateIds.filter((id) => id.trim().length > 0))];
    if (allowed.length === 0) {
      return this.fallback('no_candidates');
    }
    if (allowed.length === 1) {
      return this.fallback('single_candidate');
    }

    if (this.provider === 'openai' && !this.openaiClient) {
      return this.fallback('missing_api_key');
    }
    if (this.provider === 'gemini' && !this.client) {
      return this.fallback('missing_api_key');
    }

    try {
      this.circuitBreaker.beforeRequest();
    } catch {
      return this.fallback('circuit_open');
    }

    const templates = await this.templateService.listActive();
    const catalogBlock = this.buildCatalogBlock(templates);
    const catalogHash = createHash('sha256').update(catalogBlock).digest('hex');

    const userPayload = {
      topic: input.topic,
      query: input.query ?? null,
      ageGroup: input.ageGroup,
      grade: input.grade ?? null,
      subject: input.subject ?? null,
      difficulty: input.difficulty ?? null,
      allowedTemplateIds: [...allowed].sort(),
      promptVersion: WORKSHEET_TEMPLATE_SELECTION_PROMPT_VERSION,
    };
    const userContent = JSON.stringify(userPayload);
    const promptHash = createHash('sha256')
      .update(WORKSHEET_TEMPLATE_SELECTION_SYSTEM_PROMPT)
      .update('\n')
      .update(catalogBlock)
      .update('\n')
      .update(userContent)
      .digest('hex');

    const invocationId = randomUUID();
    const startedAt = new Date();
    const providerName = this.provider === 'openai' ? 'openai' : 'google-gemini';
    const storeAiPayload = this.configService.get<boolean>('pipelineTracking.storeAiPayload') === true;

    if (input.telemetry) {
      this.emitter.emitAiStarted({
        ...input.telemetry,
        invocationId,
        stageName: PIPELINE_STAGES.TEMPLATE_SELECTION,
        provider: providerName,
        model: this.modelName,
        purpose: WORKSHEET_TEMPLATE_SELECTION_AI_PURPOSE,
        promptHash,
        promptPayload: storeAiPayload
          ? {
              systemPromptVersion: WORKSHEET_TEMPLATE_SELECTION_PROMPT_VERSION,
              catalogHash,
              user: userPayload,
            }
          : undefined,
      });
    }

    try {
      await this.rateLimiter.acquire();

      const { text, usage, requestId } = await this.withTimeout(
        this.callProvider({
          catalogBlock,
          catalogHash,
          userContent,
        }),
        this.timeoutMs,
      );

      const latencyMs = Date.now() - startedAt.getTime();
      const parsed = this.parseResponse(text);
      if (!parsed) {
        await this.recordFailure({
          startedAt,
          latencyMs,
          requestId,
          errorType: 'malformed_json',
          usage,
          telemetry: input.telemetry,
          invocationId,
        });
        this.circuitBreaker.recordFailure();
        return this.fallback('malformed_json', catalogHash);
      }

      const allowedSet = new Set(allowed);
      if (!allowedSet.has(parsed.selectedTemplateId)) {
        await this.recordFailure({
          startedAt,
          latencyMs,
          requestId,
          errorType: 'invalid_id',
          usage,
          telemetry: input.telemetry,
          invocationId,
          responsePayload: parsed,
        });
        this.circuitBreaker.recordFailure();
        return this.fallback('invalid_id', catalogHash);
      }

      if (parsed.alternativeTemplateId !== null && !allowedSet.has(parsed.alternativeTemplateId)) {
        parsed.alternativeTemplateId = null;
      }

      if (parsed.confidenceScore < this.minConfidence) {
        await this.recordFailure({
          startedAt,
          latencyMs,
          requestId,
          errorType: 'low_confidence',
          usage,
          telemetry: input.telemetry,
          invocationId,
          responsePayload: parsed,
        });
        this.circuitBreaker.recordSuccess();
        return this.fallback('low_confidence', catalogHash);
      }

      const estimatedCost = this.estimateCost(usage);
      const result: WorksheetTemplateSelectionAiResult = {
        selectedTemplateId: parsed.selectedTemplateId,
        confidenceScore: parsed.confidenceScore,
        reasoning: parsed.reasoning,
        alternativeTemplateId: parsed.alternativeTemplateId,
        catalogHash,
        cachedInputTokens: usage.cachedInputTokens,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        estimatedCost,
        latencyMs,
      };

      this.circuitBreaker.recordSuccess();
      await this.aiUsageService.record({
        stage: WORKSHEET_TEMPLATE_SELECTION_AI_STAGE,
        provider: providerName,
        model: this.modelName,
        requestId,
        startedAt,
        completedAt: new Date(),
        latencyMs,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        estimatedCost,
        status: 'success',
        retryCount: 0,
      });

      if (input.telemetry) {
        this.emitter.emitAiCompleted({
          ...input.telemetry,
          invocationId,
          stageName: PIPELINE_STAGES.TEMPLATE_SELECTION,
          status: 'success',
          responseHash: hashPayload(parsed),
          responsePayload: storeAiPayload ? parsed : undefined,
          inputTokens: usage.inputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          estimatedCost,
          durationMs: latencyMs,
        });
      }

      return {
        result,
        usedFallback: false,
        catalogHash,
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt.getTime();
      const errorType = this.classifyError(error);
      this.circuitBreaker.recordFailure();
      await this.recordFailure({
        startedAt,
        latencyMs,
        errorType,
        telemetry: input.telemetry,
        invocationId,
        errorMessage: getErrorMessage(error),
      });
      this.logger.warn(`Worksheet AI selection failed (${errorType}): ${getErrorMessage(error)}`);
      return this.fallback(errorType, catalogHash);
    }
  }

  private buildCatalogBlock(templates: WorksheetTemplateRecord[]): string {
    const list = templates.map((t) => {
      const meta = this.templateService.parseMeta(t);
      return {
        id: t.id,
        name: t.name,
        category: t.category,
        subjects: meta.subjects,
        topics: meta.topics,
        difficulty: meta.difficulty,
        ageMin: meta.ageMin,
        ageMax: meta.ageMax,
      };
    });
    return `TEMPLATE CATALOG:\n${JSON.stringify(list, null, 2)}`;
  }

  private async callProvider(input: {
    catalogBlock: string;
    catalogHash: string;
    userContent: string;
  }): Promise<{ text: string; usage: ProviderUsage; requestId?: string }> {
    if (this.provider === 'openai') return this.callOpenAi(input);
    return this.callGemini(input);
  }

  private async callOpenAi(input: {
    catalogBlock: string;
    catalogHash: string;
    userContent: string;
  }): Promise<{ text: string; usage: ProviderUsage; requestId?: string }> {
    const response = await this.openaiClient!.chat.completions.create({
      model: this.modelName,
      temperature: 0,
      prompt_cache_key: input.catalogHash.slice(0, 64),
      messages: [
        { role: 'system', content: WORKSHEET_TEMPLATE_SELECTION_SYSTEM_PROMPT },
        { role: 'system', content: input.catalogBlock },
        { role: 'user', content: input.userContent },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: WORKSHEET_TEMPLATE_SELECTION_RESPONSE_SCHEMA.name,
          strict: WORKSHEET_TEMPLATE_SELECTION_RESPONSE_SCHEMA.strict,
          schema: WORKSHEET_TEMPLATE_SELECTION_RESPONSE_SCHEMA.schema as Record<string, unknown>,
        },
      },
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

    const text = response.choices[0]?.message?.content?.trim() ?? '';
    const cachedTokens = (response.usage as any)?.prompt_tokens_details?.cached_tokens ?? undefined;
    return {
      text,
      requestId: response.id,
      usage: {
        inputTokens: response.usage?.prompt_tokens,
        cachedInputTokens: cachedTokens,
        outputTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
      },
    };
  }

  private async callGemini(input: {
    catalogBlock: string;
    catalogHash: string;
    userContent: string;
  }): Promise<{ text: string; usage: ProviderUsage; requestId?: string }> {
    const response = await this.client!.models.generateContent({
      model: this.modelName,
      contents: [{ role: 'user', parts: [{ text: input.userContent }] }],
      config: {
        temperature: 0,
        systemInstruction: `${WORKSHEET_TEMPLATE_SELECTION_SYSTEM_PROMPT}\n\n${input.catalogBlock}`,
        responseMimeType: 'application/json',
        responseSchema: buildWorksheetTemplateSelectionGeminiSchema(),
      },
    });

    const text = response.text?.trim() ?? '';
    const geminiUsage = (response as any).usageMetadata;
    return {
      text,
      requestId: (response as any).responseId,
      usage: {
        inputTokens: geminiUsage?.promptTokenCount,
        cachedInputTokens: geminiUsage?.cachedContentTokenCount,
        outputTokens: geminiUsage?.candidatesTokenCount,
        totalTokens: geminiUsage?.totalTokenCount,
      },
    };
  }

  private parseResponse(text: string): {
    detectedIntent: string | null;
    selectedTemplateId: string;
    confidenceScore: number;
    reasoning: string;
    alternativeTemplateId: string | null;
  } | null {
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const confidenceScore = Number(parsed.confidenceScore);
      if (!parsed.selectedTemplateId || typeof parsed.selectedTemplateId !== 'string' || !Number.isFinite(confidenceScore)) {
        return null;
      }
      return {
        detectedIntent: typeof parsed.detectedIntent === 'string' ? parsed.detectedIntent.trim() : null,
        selectedTemplateId: parsed.selectedTemplateId.trim(),
        confidenceScore,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : '',
        alternativeTemplateId: typeof parsed.alternativeTemplateId === 'string' ? parsed.alternativeTemplateId.trim() : null,
      };
    } catch {
      return null;
    }
  }

  private estimateCost(usage: ProviderUsage): number | undefined {
    if (usage.inputTokens === undefined && usage.outputTokens === undefined && usage.cachedInputTokens === undefined) return undefined;
    const cached = usage.cachedInputTokens ?? 0;
    const input = Math.max((usage.inputTokens ?? 0) - cached, 0);
    const output = usage.outputTokens ?? 0;
    return (input / 1_000_000) * this.costPerMInputUsd + (cached / 1_000_000) * this.costPerMCachedInputUsd + (output / 1_000_000) * this.costPerMOutputUsd;
  }

  private classifyError(error: unknown): WorksheetTemplateSelectionAiFallbackReason {
    const message = getErrorMessage(error).toLowerCase();
    if (message.includes('timeout') || message.includes('timed out')) return 'timeout';
    return 'provider_error';
  }

  private fallback(reason: WorksheetTemplateSelectionAiFallbackReason, catalogHash?: string): WorksheetTemplateSelectionAiOutcome {
    return { result: null, usedFallback: true, fallbackReason: reason, catalogHash };
  }

  private async recordFailure(input: {
    startedAt: Date;
    latencyMs: number;
    requestId?: string;
    errorType: WorksheetTemplateSelectionAiFallbackReason;
    usage?: ProviderUsage;
    telemetry?: WorksheetTemplateSelectionAiSelectInput['telemetry'];
    invocationId: string;
    responsePayload?: unknown;
    errorMessage?: string;
  }): Promise<void> {
    const providerName = this.provider === 'openai' ? 'openai' : 'google-gemini';
    await this.aiUsageService.record({
      stage: WORKSHEET_TEMPLATE_SELECTION_AI_STAGE,
      provider: providerName,
      model: this.modelName,
      requestId: input.requestId,
      startedAt: input.startedAt,
      completedAt: new Date(),
      latencyMs: input.latencyMs,
      inputTokens: input.usage?.inputTokens,
      cachedInputTokens: input.usage?.cachedInputTokens,
      outputTokens: input.usage?.outputTokens,
      totalTokens: input.usage?.totalTokens,
      estimatedCost: input.usage ? this.estimateCost(input.usage) : undefined,
      status: 'failed',
      retryCount: 0,
      errorType: input.errorType,
    });
    if (input.telemetry) {
      this.emitter.emitAiCompleted({
        ...input.telemetry,
        invocationId: input.invocationId,
        stageName: PIPELINE_STAGES.TEMPLATE_SELECTION,
        status: 'failed',
        responsePayload: input.responsePayload,
        inputTokens: input.usage?.inputTokens,
        cachedInputTokens: input.usage?.cachedInputTokens,
        outputTokens: input.usage?.outputTokens,
        totalTokens: input.usage?.totalTokens,
        durationMs: input.latencyMs,
        errorMessage: input.errorMessage ?? input.errorType,
      });
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`AI timed out after ${timeoutMs}ms`)), timeoutMs); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

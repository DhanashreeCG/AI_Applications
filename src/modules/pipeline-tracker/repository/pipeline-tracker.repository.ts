import { Injectable } from '@nestjs/common';
import {
  PipelineExecutionStatus,
  PipelineStageStatus,
  Prisma,
} from '@generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class PipelineTrackerRepository {
  constructor(private readonly prisma: PrismaService) {}

  public createExecution(input: {
    id: string;
    requestId: string;
    correlationId: string;
    workflowType: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    return this.prisma.pipelineExecution.create({
      data: {
        id: input.id,
        requestId: input.requestId,
        correlationId: input.correlationId,
        workflowType: input.workflowType,
        status: PipelineExecutionStatus.running,
        metadata: input.metadata,
      },
    });
  }

  public async finishExecution(input: {
    id: string;
    status: PipelineExecutionStatus;
    currentStage?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    const existing = await this.prisma.pipelineExecution.findUnique({
      where: { id: input.id },
      select: { startedAt: true },
    });
    const completedAt = new Date();
    const totalDurationMs = existing
      ? completedAt.getTime() - existing.startedAt.getTime()
      : null;

    return this.prisma.pipelineExecution.update({
      where: { id: input.id },
      data: {
        status: input.status,
        currentStage: input.currentStage,
        completedAt,
        totalDurationMs: totalDurationMs ?? undefined,
        metadata: input.metadata,
      },
    });
  }

  public async nextSequence(executionId: string): Promise<number> {
    const aggregate = await this.prisma.pipelineStageExecution.aggregate({
      where: { executionId },
      _max: { sequence: true },
    });
    return (aggregate._max.sequence ?? 0) + 1;
  }

  public createStage(input: {
    executionId: string;
    stageName: string;
    sequence: number;
    status: PipelineStageStatus;
    metadata?: Prisma.InputJsonValue;
    retryCount?: number;
  }) {
    return this.prisma.pipelineStageExecution.create({
      data: {
        executionId: input.executionId,
        stageName: input.stageName,
        sequence: input.sequence,
        status: input.status,
        startedAt:
          input.status === PipelineStageStatus.running ? new Date() : null,
        metadata: input.metadata,
        retryCount: input.retryCount ?? 0,
      },
    });
  }

  public async findLatestOpenStage(executionId: string, stageName: string) {
    return this.prisma.pipelineStageExecution.findFirst({
      where: {
        executionId,
        stageName,
        status: {
          in: [PipelineStageStatus.pending, PipelineStageStatus.running],
        },
      },
      orderBy: { sequence: 'desc' },
    });
  }

  public async completeStage(input: {
    id: string;
    status: PipelineStageStatus;
    metadata?: Prisma.InputJsonValue;
    errorMessage?: string;
  }) {
    const existing = await this.prisma.pipelineStageExecution.findUnique({
      where: { id: input.id },
      select: { startedAt: true, metadata: true },
    });
    const completedAt = new Date();
    const durationMs = existing?.startedAt
      ? completedAt.getTime() - existing.startedAt.getTime()
      : null;

    const metadata = {
      ...((existing?.metadata as Record<string, unknown> | null) ?? {}),
      ...(input.metadata as Record<string, unknown> | undefined),
      ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    };

    return this.prisma.pipelineStageExecution.update({
      where: { id: input.id },
      data: {
        status: input.status,
        completedAt,
        durationMs: durationMs ?? undefined,
        metadata: Object.keys(metadata).length
          ? (metadata as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }

  public setCurrentStage(executionId: string, stageName: string) {
    return this.prisma.pipelineExecution.update({
      where: { id: executionId },
      data: { currentStage: stageName },
    });
  }

  public createAiInvocation(input: {
    id: string;
    executionId: string;
    stageExecutionId?: string | null;
    provider: string;
    model: string;
    purpose: string;
    promptHash?: string;
    promptPayload?: Prisma.InputJsonValue;
    retryCount?: number;
  }) {
    return this.prisma.pipelineAiInvocation.create({
      data: {
        id: input.id,
        executionId: input.executionId,
        stageExecutionId: input.stageExecutionId ?? null,
        provider: input.provider,
        model: input.model,
        purpose: input.purpose,
        startedAt: new Date(),
        status: 'running',
        promptHash: input.promptHash,
        promptPayload: input.promptPayload,
        retryCount: input.retryCount ?? 0,
      },
    });
  }

  public async finishAiInvocation(input: {
    id: string;
    status: string;
    responseHash?: string;
    responsePayload?: Prisma.InputJsonValue;
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    estimatedCost?: number;
    durationMs?: number;
  }) {
    const existing = await this.prisma.pipelineAiInvocation.findUnique({
      where: { id: input.id },
      select: { startedAt: true, purpose: true },
    });
    const completedAt = new Date();
    const durationMs =
      typeof input.durationMs === 'number'
        ? input.durationMs
        : existing
          ? completedAt.getTime() - existing.startedAt.getTime()
          : undefined;
    return this.prisma.pipelineAiInvocation.update({
      where: { id: input.id },
      data: {
        status: input.status,
        completedAt,
        durationMs,
        responseHash: input.responseHash,
        responsePayload: input.responsePayload,
        inputTokens: input.inputTokens,
        cachedInputTokens: input.cachedInputTokens,
        outputTokens: input.outputTokens,
        totalTokens: input.totalTokens,
        estimatedCost: input.estimatedCost,
      },
    });
  }

  public async getExecutionUsageRollups(executionId: string): Promise<{
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    llmDurationMs: number;
    imageSearchDurationMs: number;
    imageSearchCount: number;
    embeddingTokens: number;
    embeddingDurationMs: number;
    embeddingCalls: number;
  }> {
    const [ais, searches] = await Promise.all([
      this.prisma.pipelineAiInvocation.findMany({
        where: { executionId },
        select: {
          purpose: true,
          status: true,
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
          durationMs: true,
        },
      }),
      this.prisma.pipelineImageSearchExecution.findMany({
        where: { executionId },
        select: { durationMs: true },
      }),
    ]);

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalTokens = 0;
    let llmDurationMs = 0;
    let embeddingTokens = 0;
    let embeddingDurationMs = 0;
    let embeddingCalls = 0;

    for (const ai of ais) {
      if (ai.status !== 'success') {
        continue;
      }
      const isEmbedding = ai.purpose === 'flashcard_image_search_embedding';
      if (isEmbedding) {
        embeddingCalls += 1;
        embeddingTokens += ai.totalTokens ?? ai.inputTokens ?? 0;
        embeddingDurationMs += ai.durationMs ?? 0;
        continue;
      }
      totalInputTokens += ai.inputTokens ?? 0;
      totalOutputTokens += ai.outputTokens ?? 0;
      totalTokens += ai.totalTokens ?? 0;
      llmDurationMs += ai.durationMs ?? 0;
    }

    const imageSearchDurationMs = searches.reduce(
      (sum, row) => sum + (row.durationMs ?? 0),
      0,
    );

    return {
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      llmDurationMs,
      imageSearchDurationMs,
      imageSearchCount: searches.length,
      embeddingTokens,
      embeddingDurationMs,
      embeddingCalls,
    };
  }

  public createImageSearch(input: {
    id: string;
    executionId: string;
    stageExecutionId?: string | null;
    query: string;
    filters?: Prisma.InputJsonValue;
  }) {
    return this.prisma.pipelineImageSearchExecution.create({
      data: {
        id: input.id,
        executionId: input.executionId,
        stageExecutionId: input.stageExecutionId ?? null,
        query: input.query,
        filters: input.filters,
      },
    });
  }

  public completeImageSearch(input: {
    id: string;
    resultCount: number;
    selectedAssetId?: string | null;
    cacheHit?: boolean;
    failed?: boolean;
    errorMessage?: string;
    durationMs?: number;
  }) {
    return this.prisma.pipelineImageSearchExecution.update({
      where: { id: input.id },
      data: {
        resultCount: input.resultCount,
        selectedAssetId: input.selectedAssetId ?? null,
        cacheHit: input.cacheHit ?? false,
        failed: input.failed ?? false,
        errorMessage: input.errorMessage,
        durationMs: input.durationMs,
      },
    });
  }

  public findExecutionById(id: string) {
    return this.prisma.pipelineExecution.findUnique({
      where: { id },
      include: {
        stages: { orderBy: { sequence: 'asc' } },
        aiInvocations: { orderBy: { createdAt: 'asc' } },
        imageSearches: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  public findRecentExecutions(input: {
    limit: number;
    status?: string;
    workflowType?: string;
  }) {
    return this.prisma.pipelineExecution.findMany({
      where: {
        ...(input.status
          ? { status: input.status as never }
          : {}),
        ...(input.workflowType
          ? { workflowType: input.workflowType }
          : {}),
      },
      select: {
        id: true,
        requestId: true,
        correlationId: true,
        workflowType: true,
        currentStage: true,
        status: true,
        startedAt: true,
        completedAt: true,
        totalDurationMs: true,
        metadata: true,
        createdAt: true,
        _count: {
          select: {
            stages: true,
            aiInvocations: true,
            imageSearches: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: input.limit,
    });
  }

  public findExecutionsByRequestId(requestId: string) {
    return this.prisma.pipelineExecution.findMany({
      where: { requestId },
      include: {
        stages: { orderBy: { sequence: 'asc' } },
        aiInvocations: { orderBy: { createdAt: 'asc' } },
        imageSearches: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }
}

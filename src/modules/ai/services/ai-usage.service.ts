import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface RecordAiUsageInput {
  assetId?: string;
  stage: string;
  provider: string;
  model: string;
  requestId?: string;
  startedAt: Date;
  completedAt?: Date;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
  status: 'success' | 'failed' | 'skipped';
  retryCount?: number;
  errorType?: string;
}

@Injectable()
export class AiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  public async record(input: RecordAiUsageInput): Promise<void> {
    await this.prisma.aiUsage.create({
      data: {
        assetId: input.assetId,
        stage: input.stage,
        provider: input.provider,
        model: input.model,
        requestId: input.requestId,
        startedAt: input.startedAt,
        completedAt: input.completedAt ?? new Date(),
        latencyMs: input.latencyMs,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        totalTokens: input.totalTokens,
        estimatedCost: input.estimatedCost,
        status: input.status,
        retryCount: input.retryCount ?? 0,
        errorType: input.errorType,
      },
    });
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';

export interface CostEstimate {
  imagesDiscovered: number;
  duplicates: number;
  uniqueImages: number;
  alreadyProcessed: number;
  newAssets: number;
  expectedGeminiCalls: number;
  expectedEmbeddingCalls: number;
  estimatedGeminiCostUsd: number;
  estimatedOpenAiCostUsd: number;
  estimatedTotalCostUsd: number;
}

@Injectable()
export class CostEstimatorService {
  private readonly geminiUnitCost: number;
  private readonly openaiUnitCost: number;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.geminiUnitCost =
      configService.get<number>('ai.costGeminiPerImageUsd') ?? 0.001;
    this.openaiUnitCost =
      configService.get<number>('ai.costOpenAiEmbeddingPerCallUsd') ?? 0.00002;
  }

  public estimateFromCounts(params: {
    discovered: number;
    duplicates: number;
    needingMetadata: number;
    needingEmbedding: number;
    alreadyProcessed?: number;
  }): CostEstimate {
    const duplicates = params.duplicates;
    const uniqueImages = Math.max(0, params.discovered - duplicates);
    const alreadyProcessed = params.alreadyProcessed ?? 0;
    const newAssets = Math.max(0, uniqueImages - alreadyProcessed);
    const expectedGeminiCalls = Math.max(0, params.needingMetadata);
    const expectedEmbeddingCalls = Math.max(0, params.needingEmbedding);
    const estimatedGeminiCostUsd = expectedGeminiCalls * this.geminiUnitCost;
    const estimatedOpenAiCostUsd =
      expectedEmbeddingCalls * this.openaiUnitCost;

    return {
      imagesDiscovered: params.discovered,
      duplicates,
      uniqueImages,
      alreadyProcessed,
      newAssets,
      expectedGeminiCalls,
      expectedEmbeddingCalls,
      estimatedGeminiCostUsd,
      estimatedOpenAiCostUsd,
      estimatedTotalCostUsd: estimatedGeminiCostUsd + estimatedOpenAiCostUsd,
    };
  }

  /**
   * Estimate remaining AI work for a job based on current asset stage results.
   */
  public async estimateForJob(jobId: string): Promise<CostEstimate> {
    const job = await this.prisma.ingestionJob.findUnique({
      where: { id: jobId },
      include: {
        files: {
          include: {
            asset: {
              include: {
                metadata: true,
                embeddings: true,
              },
            },
          },
        },
      },
    });

    if (!job) {
      return this.estimateFromCounts({
        discovered: 0,
        duplicates: 0,
        needingMetadata: 0,
        needingEmbedding: 0,
      });
    }

    let needingMetadata = 0;
    let needingEmbedding = 0;
    let alreadyProcessed = 0;

    for (const file of job.files) {
      if (!file.assetId || !file.asset) {
        // Queued but not yet hashed/created — will need both stages if unique
        needingMetadata += 1;
        needingEmbedding += 1;
        continue;
      }

      const hasMetadata = Boolean(file.asset.metadata);
      const hasEmbedding =
        Array.isArray(file.asset.embeddings) &&
        file.asset.embeddings.length > 0;

      if (hasMetadata && hasEmbedding) {
        alreadyProcessed += 1;
        continue;
      }

      if (!hasMetadata) {
        needingMetadata += 1;
      }
      if (!hasEmbedding) {
        needingEmbedding += 1;
      }
    }

    // Files marked duplicate contribute to totalDuplicate, not AI work
    needingMetadata = Math.max(0, needingMetadata - job.totalDuplicate);
    needingEmbedding = Math.max(0, needingEmbedding - job.totalDuplicate);

    return this.estimateFromCounts({
      discovered: job.totalDiscovered || job.files.length,
      duplicates: job.totalDuplicate,
      needingMetadata,
      needingEmbedding,
      alreadyProcessed,
    });
  }

  public estimateUnitCosts(): {
    geminiPerImageUsd: number;
    openaiEmbeddingPerCallUsd: number;
  } {
    return {
      geminiPerImageUsd: this.geminiUnitCost,
      openaiEmbeddingPerCallUsd: this.openaiUnitCost,
    };
  }
}

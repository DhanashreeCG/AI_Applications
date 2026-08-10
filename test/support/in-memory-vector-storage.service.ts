import { Injectable, NotFoundException } from '@nestjs/common';
import { OPENAI_EMBEDDING_DIMENSIONS } from '../../src/modules/ai/constants/embedding.constants';
import { EmbeddingResult } from '../../src/common/interfaces/embedding-provider.interface';
import { TestPrismaService } from './test-prisma.service';
import {
  StoreEmbeddingInput,
  StoredEmbeddingRecord,
  VectorSearchResult,
} from '../../src/modules/search/interfaces/vector-search.interface';
import { cosineSimilarity } from './fixtures/embedding.fixture';

@Injectable()
export class InMemoryVectorStorageService {
  private readonly vectors = new Map<string, number[]>();

  constructor(private readonly prisma: TestPrismaService) {}

  public async storeEmbedding(
    input: StoreEmbeddingInput,
  ): Promise<StoredEmbeddingRecord> {
    this.validateVectorDimensions(input.embedding, input.dimensions);

    const latest = await this.prisma.assetEmbedding.findFirst({
      where: { assetId: input.assetId },
      orderBy: { embeddingVersion: 'desc' },
    });

    if (
      latest &&
      latest.sourceTextHash === input.sourceTextHash &&
      this.vectors.has(latest.id as string)
    ) {
      return this.toStoredRecord(latest);
    }

    const dimensions = input.dimensions ?? OPENAI_EMBEDDING_DIMENSIONS;
    const embeddingVersion = latest
      ? Number(latest.embeddingVersion) + 1
      : 1;

    let record;
    if (latest) {
      record = await this.prisma.assetEmbedding.update({
        where: { id: latest.id },
        data: {
          provider: input.provider,
          model: input.model,
          dimensions,
          sourceTextHash: input.sourceTextHash,
          embeddingVersion,
        },
      });
    } else {
      record = await this.prisma.assetEmbedding.create({
        data: {
          assetId: input.assetId,
          provider: input.provider,
          model: input.model,
          dimensions,
          sourceTextHash: input.sourceTextHash,
          embeddingVersion,
        },
      });
    }

    this.vectors.set(record.id as string, input.embedding);
    return this.toStoredRecord(record);
  }

  public async storeFromEmbeddingResult(
    assetId: string,
    result: EmbeddingResult,
  ): Promise<StoredEmbeddingRecord> {
    return this.storeEmbedding({
      assetId,
      embedding: result.embedding,
      provider: result.provider,
      model: result.model,
      sourceTextHash: result.sourceTextHash,
      dimensions: result.dimensions,
    });
  }

  public async searchSimilar(
    queryVector: number[],
    topK = 10,
  ): Promise<VectorSearchResult[]> {
    this.validateVectorDimensions(queryVector);

    const latestByAsset = new Map<string, Record<string, unknown>>();

    for (const record of this.prisma.db.assetEmbeddings.values()) {
      const assetId = record.assetId as string;
      const current = latestByAsset.get(assetId);

      if (
        !current ||
        Number(record.embeddingVersion) > Number(current.embeddingVersion)
      ) {
        latestByAsset.set(assetId, record);
      }
    }

    const results: VectorSearchResult[] = [];

    for (const record of latestByAsset.values()) {
      const vector = this.vectors.get(record.id as string);
      if (!vector) {
        continue;
      }

      const similarity = cosineSimilarity(queryVector, vector);
      results.push({
        assetId: record.assetId as string,
        embeddingId: record.id as string,
        distance: 1 - similarity,
        similarity,
      });
    }

    return results
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, topK);
  }

  public async getLatestEmbedding(
    assetId: string,
  ): Promise<StoredEmbeddingRecord | null> {
    const record = await this.prisma.assetEmbedding.findFirst({
      where: { assetId },
      orderBy: { embeddingVersion: 'desc' },
    });

    if (!record) {
      return null;
    }

    return this.toStoredRecord(record);
  }

  public async deleteEmbedding(assetId: string): Promise<void> {
    const record = await this.prisma.assetEmbedding.findFirst({
      where: { assetId },
      orderBy: { embeddingVersion: 'desc' },
    });

    if (!record) {
      throw new NotFoundException(`No embedding found for asset ${assetId}`);
    }

    this.vectors.delete(record.id as string);
    await this.prisma.assetEmbedding.delete({ where: { id: record.id } });
  }

  private validateVectorDimensions(
    vector: number[],
    expectedDimensions = OPENAI_EMBEDDING_DIMENSIONS,
  ): void {
    if (vector.length !== expectedDimensions) {
      throw new Error(
        `Expected ${expectedDimensions}-dim vector, received ${vector.length}`,
      );
    }
  }

  private toStoredRecord(record: Record<string, unknown>): StoredEmbeddingRecord {
    return {
      id: record.id as string,
      assetId: record.assetId as string,
      provider: record.provider as string,
      model: record.model as string,
      dimensions: Number(record.dimensions),
      sourceTextHash: record.sourceTextHash as string,
      embeddingVersion: Number(record.embeddingVersion),
    };
  }
}

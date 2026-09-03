import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { OPENAI_EMBEDDING_DIMENSIONS } from '../ai/constants/embedding.constants';
import { EmbeddingResult } from '../../common/interfaces/embedding-provider.interface';
import {
  StoreEmbeddingInput,
  StoredEmbeddingRecord,
  VectorSearchResult,
} from './interfaces/vector-search.interface';

interface VectorSearchRow {
  assetId: string;
  embeddingId: string;
  distance: number;
  similarity: number;
}

@Injectable()
export class VectorStorageService {
  private readonly logger = new Logger(VectorStorageService.name);

  constructor(private readonly prisma: PrismaService) {}

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
      (await this.hasStoredVector(latest.id))
    ) {
      this.logger.debug(
        `Reusing existing embedding for asset ${input.assetId} with hash ${input.sourceTextHash}`,
      );
      return this.toStoredRecord(latest);
    }

    const dimensions = input.dimensions ?? OPENAI_EMBEDDING_DIMENSIONS;
    const embeddingVersion = latest ? latest.embeddingVersion + 1 : 1;

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

    await this.writeVector(record.id, input.embedding);

    this.logger.log(
      `Stored embedding v${embeddingVersion} for asset ${input.assetId}`,
    );

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

    if (topK <= 0) {
      throw new Error('topK must be greater than 0');
    }

    const vectorLiteral = this.formatVectorLiteral(queryVector);
    // Query the base table so the HNSW index can be used. One row per asset
    // is enforced by AssetEmbedding.assetId uniqueness.
    const rows = await this.prisma.$queryRawUnsafe<VectorSearchRow[]>(
      `
        SELECT
          "assetId",
          id AS "embeddingId",
          (vector <=> $1::vector)::float8 AS distance,
          (1 - (vector <=> $1::vector))::float8 AS similarity
        FROM "AssetEmbedding"
        WHERE vector IS NOT NULL
        ORDER BY vector <=> $1::vector
        LIMIT $2
      `,
      vectorLiteral,
      topK,
    );

    return rows.map((row) => ({
      assetId: row.assetId,
      embeddingId: row.embeddingId,
      distance: Number(row.distance),
      similarity: Number(row.similarity),
    }));
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

  /**
   * Returns true when an embedding with the given source text hash already
   * has a stored vector — used to skip OpenAI before the provider call.
   */
  public async hasEmbeddingForHash(
    assetId: string,
    sourceTextHash: string,
  ): Promise<boolean> {
    const latest = await this.prisma.assetEmbedding.findFirst({
      where: { assetId },
      orderBy: { embeddingVersion: 'desc' },
    });

    if (!latest || latest.sourceTextHash !== sourceTextHash) {
      return false;
    }

    return this.hasStoredVector(latest.id);
  }

  public async deleteEmbedding(assetId: string): Promise<void> {
    const record = await this.prisma.assetEmbedding.findFirst({
      where: { assetId },
      orderBy: { embeddingVersion: 'desc' },
    });

    if (!record) {
      throw new NotFoundException(`No embedding found for asset ${assetId}`);
    }

    await this.prisma.assetEmbedding.delete({ where: { id: record.id } });
  }

  private async writeVector(
    embeddingId: string,
    embedding: number[],
  ): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "AssetEmbedding"
        SET vector = $1::vector,
            "updatedAt" = NOW()
        WHERE id = $2
      `,
      this.formatVectorLiteral(embedding),
      embeddingId,
    );
  }

  private async hasStoredVector(embeddingId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ hasVector: boolean }>>(
      `
        SELECT vector IS NOT NULL AS "hasVector"
        FROM "AssetEmbedding"
        WHERE id = $1
      `,
      embeddingId,
    );

    return rows[0]?.hasVector ?? false;
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

  private formatVectorLiteral(vector: number[]): string {
    return `[${vector.join(',')}]`;
  }

  private toStoredRecord(record: {
    id: string;
    assetId: string;
    provider: string;
    model: string;
    dimensions: number;
    sourceTextHash: string;
    embeddingVersion: number;
  }): StoredEmbeddingRecord {
    return {
      id: record.id,
      assetId: record.assetId,
      provider: record.provider,
      model: record.model,
      dimensions: record.dimensions,
      sourceTextHash: record.sourceTextHash,
      embeddingVersion: record.embeddingVersion,
    };
  }
}

import { randomUUID } from 'crypto';

export class PrismaUniqueConstraintError extends Error {
  public readonly code = 'P2002';

  constructor(message = 'Unique constraint failed') {
    super(message);
    this.name = 'PrismaClientKnownRequestError';
  }
}

type EntityWithId = { id: string };

function now(): Date {
  return new Date();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryDatabase {
  public readonly ingestionJobs = new Map<string, Record<string, unknown>>();
  public readonly ingestionFiles = new Map<string, Record<string, unknown>>();
  public readonly assets = new Map<string, Record<string, unknown>>();
  public readonly assetSources = new Map<string, Record<string, unknown>>();
  public readonly assetMetadata = new Map<string, Record<string, unknown>>();
  public readonly assetEmbeddings = new Map<string, Record<string, unknown>>();
  public readonly processingAttempts: Record<string, unknown>[] = [];

  public reset(): void {
    this.ingestionJobs.clear();
    this.ingestionFiles.clear();
    this.assets.clear();
    this.assetSources.clear();
    this.assetMetadata.clear();
    this.assetEmbeddings.clear();
    this.processingAttempts.length = 0;
  }

  public createId(): string {
    return randomUUID();
  }

  public findIngestionFileByComposite(jobId: string, driveFileId: string) {
    return [...this.ingestionFiles.values()].find(
      (file) => file.jobId === jobId && file.driveFileId === driveFileId,
    );
  }

  public findAssetByContentHash(contentHash: string) {
    return [...this.assets.values()].find(
      (asset) => asset.contentHash === contentHash,
    );
  }

  public findAssetMetadataByAssetId(assetId: string) {
    return [...this.assetMetadata.values()].find(
      (metadata) => metadata.assetId === assetId,
    );
  }

  public findLatestEmbedding(assetId: string) {
    const embeddings = [...this.assetEmbeddings.values()]
      .filter((record) => record.assetId === assetId)
      .sort(
        (left, right) =>
          Number(right.embeddingVersion) - Number(left.embeddingVersion),
      );

    return embeddings[0];
  }

  public countFilesForJob(jobId: string): number {
    return [...this.ingestionFiles.values()].filter((file) => file.jobId === jobId)
      .length;
  }

  public applyIncrement(
    current: unknown,
    updateValue: number | { increment: number },
  ): number {
    const base = Number(current ?? 0);
    if (typeof updateValue === 'number') {
      return updateValue;
    }

    return base + updateValue.increment;
  }

  public attachTimestamps<T extends EntityWithId>(
    record: T,
    existing?: Record<string, unknown>,
  ): T & { createdAt: Date; updatedAt: Date } {
    const timestamp = now();
    return {
      ...record,
      createdAt: (existing?.createdAt as Date | undefined) ?? timestamp,
      updatedAt: timestamp,
    };
  }

  public cloneRecord<T>(record: T): T {
    return clone(record);
  }
}

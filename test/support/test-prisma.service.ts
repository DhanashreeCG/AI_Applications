import { Injectable } from '@nestjs/common';
import {
  InMemoryDatabase,
  PrismaUniqueConstraintError,
} from './in-memory-database';

type WhereValue = Record<string, unknown>;

@Injectable()
export class TestPrismaService {
  constructor(public readonly db: InMemoryDatabase) {}

  public readonly ingestionJob = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const id = (data.id as string | undefined) ?? this.db.createId();
      const record = this.db.attachTimestamps({ ...data, id });
      this.db.ingestionJobs.set(id, record);
      return this.db.cloneRecord(record);
    },
    update: async ({
      where,
      data,
    }: {
      where: WhereValue;
      data: Record<string, unknown>;
    }) => this.updateRecord(this.db.ingestionJobs, where.id as string, data),
    findUnique: async ({
      where,
      include,
    }: {
      where: WhereValue;
      include?: Record<string, unknown>;
    }) => {
      const record = this.db.ingestionJobs.get(where.id as string);
      if (!record) {
        return null;
      }

      return this.applyJobIncludes(record, include);
    },
    findMany: async ({
      orderBy,
      take,
      include,
    }: {
      orderBy?: Record<string, 'asc' | 'desc'>;
      take?: number;
      include?: Record<string, unknown>;
    }) => {
      let records = [...this.db.ingestionJobs.values()];

      if (orderBy?.createdAt === 'desc') {
        records = records.sort(
          (left, right) =>
            new Date(String(right.createdAt)).getTime() -
            new Date(String(left.createdAt)).getTime(),
        );
      }

      if (take) {
        records = records.slice(0, take);
      }

      return records.map((record) => this.applyJobIncludes(record, include));
    },
  };

  public readonly ingestionFile = {
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: {
        jobId_driveFileId: { jobId: string; driveFileId: string };
      };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const existing = this.db.findIngestionFileByComposite(
        where.jobId_driveFileId.jobId,
        where.jobId_driveFileId.driveFileId,
      );

      if (existing) {
        if (Object.keys(update).length === 0) {
          return this.db.cloneRecord(existing);
        }

        return this.updateRecord(
          this.db.ingestionFiles,
          existing.id as string,
          update,
        );
      }

      const id = (create.id as string | undefined) ?? this.db.createId();
      const record = this.db.attachTimestamps({ ...create, id });
      this.db.ingestionFiles.set(id, record);
      return this.db.cloneRecord(record);
    },
    update: async ({
      where,
      data,
    }: {
      where: WhereValue;
      data: Record<string, unknown>;
    }) =>
      this.updateRecord(this.db.ingestionFiles, where.id as string, data),
    findUnique: async ({ where }: { where: WhereValue }) => {
      const record = this.db.ingestionFiles.get(where.id as string);
      return record ? this.db.cloneRecord(record) : null;
    },
  };

  public readonly asset = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      if (data.contentHash) {
        const duplicate = this.db.findAssetByContentHash(
          data.contentHash as string,
        );
        if (duplicate) {
          throw new PrismaUniqueConstraintError();
        }
      }

      const id = (data.id as string | undefined) ?? this.db.createId();
      const record = this.db.attachTimestamps({ ...data, id });
      this.db.assets.set(id, record);
      return this.db.cloneRecord(record);
    },
    update: async ({
      where,
      data,
    }: {
      where: WhereValue;
      data: Record<string, unknown>;
    }) => this.updateRecord(this.db.assets, where.id as string, data),
    findUnique: async ({
      where,
      include,
    }: {
      where: WhereValue;
      include?: Record<string, unknown>;
    }) => {
      let record: Record<string, unknown> | undefined;

      if (where.id) {
        record = this.db.assets.get(where.id as string);
      } else if (where.contentHash) {
        record = this.db.findAssetByContentHash(where.contentHash as string);
      }

      if (!record) {
        return null;
      }

      return this.applyAssetIncludes(record, include);
    },
    findMany: async ({
      where,
      include,
    }: {
      where?: Record<string, unknown>;
      include?: Record<string, unknown>;
    }) => {
      let records = [...this.db.assets.values()];

      if (where?.id && typeof where.id === 'object' && 'in' in where.id) {
        const ids = new Set(where.id.in as string[]);
        records = records.filter((record) => ids.has(record.id as string));
      }

      if (
        where?.metadata &&
        typeof where.metadata === 'object' &&
        'isNot' in where.metadata &&
        where.metadata.isNot === null
      ) {
        records = records.filter((record) =>
          Boolean(this.db.findAssetMetadataByAssetId(record.id as string)),
        );
      }

      return records.map((record) => this.applyAssetIncludes(record, include));
    },
  };

  public readonly assetSource = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const id = this.db.createId();
      const record = this.db.attachTimestamps({ ...data, id });
      this.db.assetSources.set(id, record);
      return this.db.cloneRecord(record);
    },
  };

  public readonly assetMetadata = {
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: WhereValue;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const existing = this.db.findAssetMetadataByAssetId(where.assetId as string);

      if (existing) {
        const flattenedUpdate = this.flattenMetadataInput(update);
        return this.updateRecord(
          this.db.assetMetadata,
          existing.id as string,
          flattenedUpdate,
        );
      }

      const flattenedCreate = this.flattenMetadataInput(create);
      const id = this.db.createId();
      const assetId =
        (flattenedCreate.assetId as string | undefined) ??
        ((create.asset as { connect?: { id: string } })?.connect?.id as
          | string
          | undefined);

      const record = this.db.attachTimestamps({
        ...flattenedCreate,
        id,
        assetId,
      });
      this.db.assetMetadata.set(id, record);
      return this.db.cloneRecord(record);
    },
    findUnique: async ({ where }: { where: WhereValue }) => {
      const record = this.db.findAssetMetadataByAssetId(where.assetId as string);
      return record ? this.db.cloneRecord(record) : null;
    },
  };

  public readonly assetEmbedding = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const id = this.db.createId();
      const record = this.db.attachTimestamps({ ...data, id });
      this.db.assetEmbeddings.set(id, record);
      return this.db.cloneRecord(record);
    },
    update: async ({
      where,
      data,
    }: {
      where: WhereValue;
      data: Record<string, unknown>;
    }) => this.updateRecord(this.db.assetEmbeddings, where.id as string, data),
    findFirst: async ({
      where,
      orderBy,
    }: {
      where: WhereValue;
      orderBy?: { embeddingVersion: 'asc' | 'desc' };
    }) => {
      let records = [...this.db.assetEmbeddings.values()].filter(
        (record) => record.assetId === where.assetId,
      );

      if (orderBy?.embeddingVersion === 'desc') {
        records = records.sort(
          (left, right) =>
            Number(right.embeddingVersion) - Number(left.embeddingVersion),
        );
      }

      const record = records[0];
      return record ? this.db.cloneRecord(record) : null;
    },
    delete: async ({ where }: { where: WhereValue }) => {
      this.db.assetEmbeddings.delete(where.id as string);
      return { id: where.id };
    },
  };

  public readonly processingAttempt = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const id = this.db.createId();
      const record = this.db.attachTimestamps({ ...data, id });
      this.db.processingAttempts.push(record);
      return this.db.cloneRecord(record);
    },
  };

  public async $transaction<T>(
    callback: (tx: TestPrismaService) => Promise<T>,
  ): Promise<T> {
    return callback(this);
  }

  public async onModuleInit(): Promise<void> {
    return undefined;
  }

  public async onModuleDestroy(): Promise<void> {
    return undefined;
  }

  public async $connect(): Promise<void> {
    return undefined;
  }

  public async $disconnect(): Promise<void> {
    return undefined;
  }

  private updateRecord(
    store: Map<string, Record<string, unknown>>,
    id: string,
    data: Record<string, unknown>,
  ) {
    const existing = store.get(id);
    if (!existing) {
      throw new Error(`Record ${id} not found`);
    }

    const next = { ...existing };

    for (const [key, value] of Object.entries(data)) {
      if (
        value &&
        typeof value === 'object' &&
        'increment' in (value as Record<string, unknown>)
      ) {
        next[key] = this.db.applyIncrement(existing[key], value as {
          increment: number;
        });
      } else {
        next[key] = value;
      }
    }

    const record = this.db.attachTimestamps(
      next as Record<string, unknown> & { id: string },
      existing,
    );
    store.set(id, record);
    return this.db.cloneRecord(record);
  }

  private applyJobIncludes(
    record: Record<string, unknown>,
    include?: Record<string, unknown>,
  ) {
    const result = this.db.cloneRecord(record);

    if (include?._count && typeof include._count === 'object') {
      const select = (include._count as { select?: Record<string, boolean> })
        .select;
      if (select?.files) {
        (result as Record<string, unknown>)._count = {
          files: this.db.countFilesForJob(record.id as string),
        };
      }
    }

    return result;
  }

  private applyAssetIncludes(
    record: Record<string, unknown>,
    include?: Record<string, unknown>,
  ) {
    const result = this.db.cloneRecord(record);

    if (include?.metadata) {
      (result as Record<string, unknown>).metadata =
        this.db.findAssetMetadataByAssetId(record.id as string) ?? null;
    }

    return result;
  }

  private flattenMetadataInput(input: Record<string, unknown>) {
    const flattened = { ...input };

    if (input.asset && typeof input.asset === 'object' && 'connect' in input.asset) {
      flattened.assetId = (
        input.asset as { connect: { id: string } }
      ).connect.id;
      delete flattened.asset;
    }

    return flattened;
  }
}

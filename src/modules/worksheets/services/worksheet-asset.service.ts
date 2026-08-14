import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SearchService } from '../../search/search.service';
import { mapWithConcurrency } from '../constants/worksheet.constants';
import { ResolvedAssetSlot } from '../types/worksheet.types';
import { collectImageQueries, setValueAtPath } from '../utils/structure.util';

@Injectable()
export class WorksheetAssetService {
  private readonly logger = new Logger(WorksheetAssetService.name);
  private readonly concurrency: number;
  private readonly searchLimit: number;

  constructor(
    private readonly searchService: SearchService,
    private readonly configService: ConfigService,
  ) {
    this.concurrency =
      this.configService.get<number>('worksheets.imageConcurrency') ?? 3;
    this.searchLimit =
      this.configService.get<number>('worksheets.imageSearchLimit') ?? 1;
  }

  public async attachAssets(
    structure: Record<string, unknown>,
    options?: { grades?: string[]; ageGroups?: string[] },
  ): Promise<{ structure: Record<string, unknown>; slots: ResolvedAssetSlot[] }> {
    const queries = collectImageQueries(structure);
    const uniqueParents = new Map<string, { path: string; query: string }>();
    for (const item of queries) {
      uniqueParents.set(item.parentPath, {
        path: item.parentPath,
        query: item.query,
      });
    }

    const slots = await mapWithConcurrency(
      [...uniqueParents.values()],
      this.concurrency,
      async (item) => this.resolveSlot(item.query, item.path, options),
    );

    let next = structure;
    for (const slot of slots) {
      if (!slot.assetId) {
        continue;
      }
      const parent =
        slot.path === ''
          ? next
          : (this.getParent(next, slot.path) as Record<string, unknown>);
      if (parent && typeof parent === 'object') {
        if (slot.path === '') {
          next = { ...next, assetId: slot.assetId };
        } else {
          next = setValueAtPath(next, `${slot.path}.assetId`, slot.assetId);
        }
      }
    }

    return { structure: next, slots };
  }

  public async resolveSlot(
    imageQuery: string,
    path: string,
    options?: { grades?: string[]; ageGroups?: string[] },
  ): Promise<ResolvedAssetSlot> {
    const query = imageQuery.trim();
    if (!query) {
      return { path, imageQuery: query, assetId: null };
    }

    try {
      const response = await this.searchService.search({
        query,
        limit: this.searchLimit,
        filters: {
          grades: options?.grades,
          ageGroups: options?.ageGroups,
        },
      });
      const assetId = response.results[0]?.assetId ?? null;
      if (!assetId) {
        this.logger.warn(`No asset found for imageQuery "${query}" at ${path}`);
      }
      return { path, imageQuery: query, assetId };
    } catch (error) {
      this.logger.warn(
        `Asset search failed for imageQuery "${query}" at ${path}`,
      );
      return { path, imageQuery: query, assetId: null };
    }
  }

  private getParent(
    root: Record<string, unknown>,
    path: string,
  ): unknown {
    if (!path) {
      return root;
    }
    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let current: unknown = root;
    for (const part of parts) {
      if (current == null) {
        return null;
      }
      if (Array.isArray(current) && /^\d+$/.test(part)) {
        current = current[Number(part)];
      } else if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return null;
      }
    }
    return current;
  }
}

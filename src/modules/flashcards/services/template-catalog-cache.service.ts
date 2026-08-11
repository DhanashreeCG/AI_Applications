import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import {
  CatalogTemplateEntry,
  TemplateCatalogSnapshot,
} from '../interfaces/template-selection-ai.interfaces';
import { parseEditableComponentsFromLayout } from '../utils/template-layout.util';

@Injectable()
export class TemplateCatalogCacheService {
  private readonly logger = new Logger(TemplateCatalogCacheService.name);
  private cache: TemplateCatalogSnapshot | null = null;
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.ttlMs =
      this.configService.get<number>(
        'flashcards.templateSelectionAi.catalogTtlMs',
      ) ?? 600_000;
  }

  public invalidate(): void {
    this.cache = null;
    this.logger.debug('Template catalog cache invalidated');
  }

  public async getSnapshot(): Promise<TemplateCatalogSnapshot> {
    const now = Date.now();
    if (this.cache && now - this.cache.builtAt < this.ttlMs) {
      return this.cache;
    }

    const snapshot = await this.buildSnapshot();
    this.cache = snapshot;
    return snapshot;
  }

  private async buildSnapshot(): Promise<TemplateCatalogSnapshot> {
    const templates = await this.prisma.flashcardTemplate.findMany({
      where: { active: true },
      orderBy: [{ id: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        templateType: true,
        layoutType: true,
        tags: true,
        learningObjectives: true,
        subjectsSupported: true,
        difficultyLevels: true,
        layoutDefinition: true,
      },
    });

    const entries: CatalogTemplateEntry[] = templates.map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description?.trim() || '',
      templateType: template.templateType,
      layoutType: template.layoutType,
      tags: [...template.tags].sort(),
      learningObjectives: [...template.learningObjectives].sort(),
      subjectsSupported: [...template.subjectsSupported].sort(),
      difficultyLevels: [...template.difficultyLevels].sort(),
      componentSummary: deriveComponentSummary(template.layoutDefinition),
    }));

    // Stable serialization: fixed key order, sorted entries (already by id).
    const catalogPayload = {
      templates: entries.map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        templateType: entry.templateType,
        layoutType: entry.layoutType,
        tags: entry.tags,
        learningObjectives: entry.learningObjectives,
        subjectsSupported: entry.subjectsSupported,
        difficultyLevels: entry.difficultyLevels,
        componentSummary: entry.componentSummary,
      })),
    };

    const catalogJson = JSON.stringify(catalogPayload);
    const catalogBlock = `TEMPLATE CATALOG\n${catalogJson}`;
    const catalogHash = createHash('sha256').update(catalogBlock).digest('hex');

    this.logger.debug(
      `Built template catalog: ${entries.length} templates, hash=${catalogHash.slice(0, 12)}`,
    );

    return {
      catalogBlock,
      catalogHash,
      entries,
      builtAt: Date.now(),
    };
  }
}

/**
 * Derive a short, token-cheap summary of editable slots from layoutDefinition.
 * Never exposes the full layout JSON to the LLM.
 */
export function deriveComponentSummary(layoutDefinition: unknown): string {
  try {
    const editable = parseEditableComponentsFromLayout(layoutDefinition);
    const counts = new Map<string, number>();
    for (const component of editable) {
      const key = component.componentType;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const parts = [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, count]) => `${count} ${type}`);

    return parts.length ? parts.join(' + ') : 'no editable components';
  } catch {
    return 'unknown layout';
  }
}

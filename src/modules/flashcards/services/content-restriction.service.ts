import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  ContentRestrictionCategory,
  ContentRestrictionSeverity,
} from '@generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { DEFAULT_CONTENT_RESTRICTIONS } from '../constants/content-restriction.defaults';
import { hydrateContentRestrictions } from '../utils/content-restriction.registry';

@Injectable()
export class ContentRestrictionService implements OnModuleInit {
  private readonly logger = new Logger(ContentRestrictionService.name);

  constructor(private readonly prisma: PrismaService) {}

  public async onModuleInit(): Promise<void> {
    try {
      await this.ensureDefaultsSeeded();
      await this.reload();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Content restriction seed/load failed. Apply pending Prisma migrations, then restart. ${message}`,
      );
      throw error;
    }
  }

  public async reload(): Promise<void> {
    const rows = await this.prisma.contentRestrictionTerm.findMany({
      where: { active: true },
    });
    hydrateContentRestrictions(
      rows.map((row) => ({
        term: row.term,
        category: row.category,
        severity: row.severity,
        countryCode: row.countryCode,
        active: row.active,
        notes: row.notes,
      })),
    );
    this.logger.log(
      `Loaded ${rows.length} active content restriction term(s) from the database`,
    );
  }

  private async ensureDefaultsSeeded(): Promise<void> {
    const result = await this.prisma.contentRestrictionTerm.createMany({
      data: DEFAULT_CONTENT_RESTRICTIONS.map((row) => ({
        term: row.term,
        category: row.category as ContentRestrictionCategory,
        severity: row.severity as ContentRestrictionSeverity,
        countryCode: row.countryCode,
        active: true,
        notes: row.notes ?? null,
      })),
      skipDuplicates: true,
    });
    if (result.count > 0) {
      this.logger.log(`Seeded ${result.count} default content restriction term(s)`);
    }
  }
}

import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  ContentRestrictionCategory,
  ContentRestrictionSeverity,
  Prisma,
} from '@generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { DEFAULT_CONTENT_RESTRICTIONS } from '../constants/content-restriction.defaults';
import {
  CreateContentRestrictionDto,
  UpdateContentRestrictionDto,
} from '../dto/content-restriction.dto';
import { FlashcardException } from '../errors/flashcard.exception';
import { hydrateContentRestrictions } from '../utils/content-restriction.registry';

const CATEGORIES = new Set(['ANIMAL_FOOD', 'VISUAL_MOTIF', 'RELIGIOUS', 'OTHER']);
const SEVERITIES = new Set(['BANNED', 'RESTRICTED']);

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

  public async list() {
    return this.prisma.contentRestrictionTerm.findMany({
      orderBy: [{ countryCode: 'asc' }, { severity: 'asc' }, { term: 'asc' }],
    });
  }

  public async create(dto: CreateContentRestrictionDto) {
    try {
      const row = await this.prisma.contentRestrictionTerm.create({
        data: this.toCreateData(dto),
      });
      await this.reload();
      return row;
    } catch (error) {
      this.rethrowUnique(error);
    }
  }

  public async update(id: string, dto: UpdateContentRestrictionDto) {
    await this.requireById(id);
    try {
      const row = await this.prisma.contentRestrictionTerm.update({
        where: { id },
        data: this.toUpdateData(dto),
      });
      await this.reload();
      return row;
    } catch (error) {
      this.rethrowUnique(error);
    }
  }

  public async remove(id: string) {
    await this.requireById(id);
    await this.prisma.contentRestrictionTerm.delete({ where: { id } });
    await this.reload();
    return { id, deleted: true };
  }

  private async requireById(id: string) {
    const row = await this.prisma.contentRestrictionTerm.findUnique({
      where: { id },
    });
    if (!row) {
      throw new FlashcardException(
        'INVALID_FIELD',
        `Content restriction "${id}" was not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return row;
  }

  private toCreateData(dto: CreateContentRestrictionDto) {
    const term = this.normalizeTerm(dto.term);
    if (!term) {
      throw new FlashcardException('INVALID_REQUEST', 'term is required');
    }
    return {
      term,
      severity: this.normalizeSeverity(dto.severity),
      countryCode: this.normalizeCountryCode(dto.countryCode),
      category: this.normalizeCategory(dto.category),
      active: dto.active !== false,
      notes: dto.notes?.trim() || null,
    };
  }

  private toUpdateData(dto: UpdateContentRestrictionDto): Prisma.ContentRestrictionTermUpdateInput {
    const data: Prisma.ContentRestrictionTermUpdateInput = {};
    if (dto.term !== undefined) data.term = this.normalizeTerm(dto.term);
    if (dto.severity !== undefined) data.severity = this.normalizeSeverity(dto.severity);
    if (dto.countryCode !== undefined) {
      data.countryCode = this.normalizeCountryCode(dto.countryCode);
    }
    if (dto.category !== undefined) data.category = this.normalizeCategory(dto.category);
    if (dto.active !== undefined) data.active = Boolean(dto.active);
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;
    return data;
  }

  private normalizeTerm(term: string): string {
    return String(term || '')
      .trim()
      .toLowerCase();
  }

  private normalizeCountryCode(countryCode?: string): string {
    const raw = String(countryCode || '*')
      .trim()
      .toUpperCase();
    if (!raw || raw === '*' || raw === 'GLOBAL') return '*';
    if (!/^[A-Z]{2}$/.test(raw)) {
      throw new FlashcardException(
        'INVALID_REQUEST',
        'countryCode must be a 2-letter ISO code or * for global',
      );
    }
    return raw;
  }

  private normalizeSeverity(severity?: string): ContentRestrictionSeverity {
    const value = String(severity || 'BANNED').trim().toUpperCase();
    if (!SEVERITIES.has(value)) {
      throw new FlashcardException(
        'INVALID_REQUEST',
        'severity must be BANNED or RESTRICTED',
      );
    }
    return value as ContentRestrictionSeverity;
  }

  private normalizeCategory(category?: string): ContentRestrictionCategory {
    const value = String(category || 'OTHER').trim().toUpperCase();
    if (!CATEGORIES.has(value)) {
      throw new FlashcardException(
        'INVALID_REQUEST',
        'category must be ANIMAL_FOOD, VISUAL_MOTIF, RELIGIOUS, or OTHER',
      );
    }
    return value as ContentRestrictionCategory;
  }

  private rethrowUnique(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new FlashcardException(
        'INVALID_REQUEST',
        'A term with this country and severity already exists',
        HttpStatus.CONFLICT,
      );
    }
    throw error;
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

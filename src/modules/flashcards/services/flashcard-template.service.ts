import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@generated/prisma/client';
import { FlashcardException } from '../errors/flashcard.exception';
import {
  UploadFlashcardTemplateDto,
  UploadFlashcardTemplatesDto,
} from '../dto/upload-flashcard-template.dto';
import { SelectedTemplatePayload } from '../interfaces/flashcard.interfaces';
import { parseEditableComponentsFromLayout } from '../utils/template-layout.util';
import { TemplateRepository } from './template.repository';

export interface UploadFlashcardTemplatesResult {
  count: number;
  templates: SelectedTemplatePayload[];
}

@Injectable()
export class FlashcardTemplateService {
  constructor(private readonly templateRepository: TemplateRepository) {}

  public async upload(
    dto: UploadFlashcardTemplatesDto,
  ): Promise<UploadFlashcardTemplatesResult> {
    if (!Array.isArray(dto?.templates) || dto.templates.length === 0) {
      throw new FlashcardException(
        'INVALID_REQUEST',
        'templates must be a non-empty array',
        HttpStatus.BAD_REQUEST,
        { field: 'templates' },
      );
    }

    const prepared = dto.templates.map((item, index) =>
      this.prepareTemplate(item, index),
    );

    try {
      const templates =
        await this.templateRepository.createTemplates(prepared);
      return { count: templates.length, templates };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new FlashcardException(
          'INVALID_REQUEST',
          'One or more templates conflict with an existing name + templateVersion',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  private prepareTemplate(
    dto: UploadFlashcardTemplateDto,
    index: number,
  ): {
    name: string;
    description: string | null;
    templateType: string;
    layoutType: string;
    supportedAgeGroups: string[];
    supportedGrades: string[];
    learningObjectives: string[];
    subjectsSupported: string[];
    difficultyLevels: string[];
    tags: string[];
    pageSize: string;
    orientation: string;
    layoutDefinition: Prisma.InputJsonValue;
    thumbnail: string | null;
    templateVersion: string;
    active: boolean;
  } {
    const prefix = `templates[${index}]`;
    try {
      const name = this.requireString(dto.name, 'name');
      const templateType = this.requireString(dto.templateType, 'templateType');
      const layoutType = this.requireString(dto.layoutType, 'layoutType');
      const supportedAgeGroups = this.requireStringArray(
        dto.supportedAgeGroups,
        'supportedAgeGroups',
      );
      const learningObjectives = this.requireStringArray(
        dto.learningObjectives,
        'learningObjectives',
      );

      if (!dto.layoutDefinition || typeof dto.layoutDefinition !== 'object') {
        throw new FlashcardException(
          'INVALID_REQUEST',
          'layoutDefinition must be an object',
          HttpStatus.BAD_REQUEST,
        );
      }

      // New uploads must use region-based layout (id/type/editable on each component).
      if (
        !Array.isArray(dto.layoutDefinition.regions) ||
        dto.layoutDefinition.regions.length === 0
      ) {
        throw new FlashcardException(
          'INVALID_REQUEST',
          'layoutDefinition.regions must be a non-empty array',
          HttpStatus.BAD_REQUEST,
        );
      }
      parseEditableComponentsFromLayout(dto.layoutDefinition);

      return {
        name,
        description: this.optionalString(dto.description) ?? null,
        templateType,
        layoutType,
        supportedAgeGroups,
        supportedGrades: this.optionalStringArray(dto.supportedGrades),
        learningObjectives,
        subjectsSupported: this.optionalStringArray(dto.subjectsSupported),
        difficultyLevels: this.optionalStringArray(dto.difficultyLevels),
        tags: this.optionalStringArray(dto.tags),
        pageSize: this.optionalString(dto.pageSize) || 'A6',
        orientation: this.optionalString(dto.orientation) || 'PORTRAIT',
        layoutDefinition: dto.layoutDefinition as Prisma.InputJsonValue,
        thumbnail: this.optionalString(dto.thumbnail) ?? null,
        templateVersion: this.optionalString(dto.templateVersion) || '1.0',
        active: dto.active !== false,
      };
    } catch (error) {
      if (error instanceof FlashcardException) {
        const response = error.getResponse() as {
          error?: { message?: string; details?: Record<string, unknown> | null };
        };
        const originalMessage =
          response?.error?.message || 'Invalid template payload';
        throw new FlashcardException(
          error.code,
          `${prefix}: ${originalMessage}`,
          error.getStatus(),
          {
            ...(response?.error?.details ?? {}),
            index,
            path: prefix,
          },
        );
      }
      throw error;
    }
  }

  private requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new FlashcardException(
        'INVALID_REQUEST',
        `${field} is required`,
        HttpStatus.BAD_REQUEST,
        { field },
      );
    }
    return value.trim();
  }

  private optionalString(value: unknown): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }

  private requireStringArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new FlashcardException(
        'INVALID_REQUEST',
        `${field} must be a non-empty string array`,
        HttpStatus.BAD_REQUEST,
        { field },
      );
    }
    const items = value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
    if (!items.length) {
      throw new FlashcardException(
        'INVALID_REQUEST',
        `${field} must be a non-empty string array`,
        HttpStatus.BAD_REQUEST,
        { field },
      );
    }
    return items;
  }

  private optionalStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

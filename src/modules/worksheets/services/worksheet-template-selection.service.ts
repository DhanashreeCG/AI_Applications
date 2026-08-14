import { HttpStatus, Injectable } from '@nestjs/common';
import { WorksheetException } from '../errors/worksheet.exception';
import { GenerateWorksheetRequest } from '../types/worksheet.types';
import {
  WorksheetTemplateRecord,
  WorksheetTemplateService,
} from './worksheet-template.service';

@Injectable()
export class WorksheetTemplateSelectionService {
  constructor(private readonly templateService: WorksheetTemplateService) {}

  public async select(
    request: GenerateWorksheetRequest,
  ): Promise<WorksheetTemplateRecord> {
    const explicit = request.templateId?.trim();
    if (explicit) {
      return this.templateService.getActiveByIdOrSlug(explicit);
    }

    const templates = await this.templateService.listActive();
    const eligible = templates.filter((template) =>
      this.isEligible(template, request),
    );

    if (!eligible.length) {
      throw new WorksheetException(
        'NO_TEMPLATE_FOUND',
        'No active worksheet template matches the request',
        HttpStatus.NOT_FOUND,
        {
          grade: request.grade ?? null,
          subject: request.subject ?? null,
          topic: request.topic ?? null,
        },
      );
    }

    eligible.sort((a, b) => this.score(b, request) - this.score(a, request));
    return eligible[0];
  }

  public isEligible(
    template: WorksheetTemplateRecord,
    request: GenerateWorksheetRequest,
  ): boolean {
    if (template.status !== 'ACTIVE') {
      return false;
    }
    const meta = this.templateService.parseMeta(template);

    if (
      request.grade?.trim() &&
      meta.grades?.length &&
      !this.includesInsensitive(meta.grades, request.grade)
    ) {
      return false;
    }
    if (
      request.subject?.trim() &&
      meta.subjects?.length &&
      !this.includesInsensitive(meta.subjects, request.subject)
    ) {
      return false;
    }
    if (
      request.topic?.trim() &&
      meta.topics?.length &&
      !this.includesInsensitive(meta.topics, request.topic)
    ) {
      return false;
    }
    if (
      request.difficulty?.trim() &&
      meta.difficulty?.length &&
      !this.includesInsensitive(meta.difficulty, request.difficulty)
    ) {
      return false;
    }

    const requestAge = this.resolveAge(request);
    if (
      requestAge != null &&
      meta.ageMin != null &&
      meta.ageMax != null &&
      (requestAge < meta.ageMin || requestAge > meta.ageMax)
    ) {
      return false;
    }

    return true;
  }

  public score(
    template: WorksheetTemplateRecord,
    request: GenerateWorksheetRequest,
  ): number {
    const meta = this.templateService.parseMeta(template);
    let score = 0;
    if (request.grade && this.includesInsensitive(meta.grades, request.grade)) {
      score += 10;
    }
    if (request.subject && this.includesInsensitive(meta.subjects, request.subject)) {
      score += 8;
    }
    if (request.topic && this.includesInsensitive(meta.topics, request.topic)) {
      score += 8;
    }
    if (
      request.difficulty &&
      this.includesInsensitive(meta.difficulty, request.difficulty)
    ) {
      score += 4;
    }
    const requestAge = this.resolveAge(request);
    if (
      requestAge != null &&
      meta.ageMin != null &&
      meta.ageMax != null &&
      requestAge >= meta.ageMin &&
      requestAge <= meta.ageMax
    ) {
      score += 6;
    }
    return score;
  }

  private includesInsensitive(
    values: string[] | undefined,
    candidate: string,
  ): boolean {
    if (!values?.length) {
      return false;
    }
    const needle = candidate.trim().toLowerCase();
    return values.some((value) => value.trim().toLowerCase() === needle);
  }

  private resolveAge(request: GenerateWorksheetRequest): number | null {
    if (typeof request.age === 'number' && Number.isFinite(request.age)) {
      return request.age;
    }
    const group = request.ageGroup?.trim();
    if (!group) {
      return null;
    }
    const match = group.match(/(\d+)/);
    return match ? Number(match[1]) : null;
  }
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { WorksheetException } from '../errors/worksheet.exception';
import { GenerateWorksheetRequest } from '../types/worksheet.types';
import {
  WorksheetTemplateRecord,
  WorksheetTemplateService,
} from './worksheet-template.service';
import { WorksheetTemplateSelectionAiService } from './worksheet-template-selection-ai.service';
import { PipelineTelemetryContext } from '../../../common/events/pipeline-tracker.events';

@Injectable()
export class WorksheetTemplateSelectionService {
  constructor(
    private readonly templateService: WorksheetTemplateService,
    private readonly aiService: WorksheetTemplateSelectionAiService,
  ) {}

  public async select(
    request: GenerateWorksheetRequest,
    telemetry?: PipelineTelemetryContext,
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

    if (eligible.length > 1) {
      const outcome = await this.aiService.select({
        topic: request.topic ?? null,
        query: request.query ?? null,
        ageGroup: request.ageGroup ?? null,
        grade: request.grade ?? null,
        subject: request.subject ?? null,
        difficulty: request.difficulty ?? null,
        allowedTemplateIds: eligible.map((t) => t.id),
        telemetry,
      });

      if (!outcome.usedFallback && outcome.result) {
        const aiSelected = eligible.find((t) => t.id === outcome.result!.selectedTemplateId);
        if (aiSelected) {
          (aiSelected as any)._aiOutcome = outcome;
          return aiSelected;
        }
      }
      (eligible[0] as any)._aiOutcome = outcome;
      return eligible[0];
    }

    (eligible[0] as any)._aiOutcome = {
      usedFallback: true,
      fallbackReason: 'single_candidate',
    };
    return eligible[0];
  }

  public async listMatching(
    request: GenerateWorksheetRequest,
    limit = 10,
    telemetry?: PipelineTelemetryContext,
  ): Promise<WorksheetTemplateRecord[]> {
    const explicit = request.templateId?.trim();
    if (explicit) {
      return [await this.templateService.getActiveByIdOrSlug(explicit)];
    }

    const templates = await this.templateService.listActive();
    const eligible = templates.filter((template) =>
      this.isEligibleForSet(template, request),
    );
    eligible.sort((a, b) => this.score(b, request) - this.score(a, request));

    if (eligible.length > 1) {
      const outcome = await this.aiService.select({
        topic: request.topic ?? null,
        query: request.query ?? null,
        ageGroup: request.ageGroup ?? null,
        grade: request.grade ?? null,
        subject: request.subject ?? null,
        difficulty: request.difficulty ?? null,
        allowedTemplateIds: eligible.map((t) => t.id),
        telemetry,
      });

      if (!outcome.usedFallback && outcome.result) {
        const selectedId = outcome.result.selectedTemplateId;
        const alternativeId = outcome.result.alternativeTemplateId;
        
        const sortedPool = [...eligible];
        if (alternativeId) {
          const altIdx = sortedPool.findIndex((t) => t.id === alternativeId);
          if (altIdx !== -1) {
            const [altTemp] = sortedPool.splice(altIdx, 1);
            sortedPool.unshift(altTemp);
          }
        }
        if (selectedId) {
          const selIdx = sortedPool.findIndex((t) => t.id === selectedId);
          if (selIdx !== -1) {
            const [selTemp] = sortedPool.splice(selIdx, 1);
            sortedPool.unshift(selTemp);
          }
        }
        return sortedPool.slice(0, Math.max(1, limit));
      }
    }

    return eligible.slice(0, Math.max(1, limit));
  }

  public isEligibleForSet(
    template: WorksheetTemplateRecord,
    request: GenerateWorksheetRequest,
  ): boolean {
    if (template.status !== 'ACTIVE') {
      return false;
    }
    const meta = this.templateService.parseMeta(template);
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

  private matchesGrade(templateGrades: string[], requestGrade: string): boolean {
    if (!requestGrade?.trim() || !templateGrades?.length) {
      return true;
    }
    const clean = requestGrade.trim().toLowerCase();
    const cleanTemplates = templateGrades.map((g) => g.trim().toLowerCase());

    if (cleanTemplates.includes(clean)) {
      return true;
    }

    const aliases: Record<string, string[]> = {
      fs0: ['fs0', 'nursery', 'pre-k', '2-3'],
      nursery: ['fs0', 'nursery', 'pre-k', '2-3'],
      fs1: ['fs1', 'lkg', 'kg1', 'preschool', '3-4'],
      lkg: ['fs1', 'lkg', 'kg1', 'preschool', '3-4'],
      fs2: ['fs2', 'ukg', 'kg2', 'kindergarten', '4-5'],
      ukg: ['fs2', 'ukg', 'kg2', 'kindergarten', '4-5'],
      grade1: ['grade 1', 'grade1', '1st grade', 'class 1', '5-6'],
      'grade 1': ['grade 1', 'grade1', '1st grade', 'class 1', '5-6'],
      grade2: ['grade 2', 'grade2', '2nd grade', 'class 2', '6-7'],
      'grade 2': ['grade 2', 'grade2', '2nd grade', 'class 2', '6-7'],
      grade3: ['grade 3', 'grade3', '3rd grade', 'class 3', '7-8'],
      'grade 3': ['grade 3', 'grade3', '3rd grade', 'class 3', '7-8'],
    };

    const targetAliases = aliases[clean];
    if (targetAliases) {
      return cleanTemplates.some((tg) => targetAliases.includes(tg));
    }

    return false;
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
      !this.matchesGrade(meta.grades, request.grade)
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

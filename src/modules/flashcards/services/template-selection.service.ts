import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FlashcardException } from '../errors/flashcard.exception';
import { SelectedTemplatePayload } from '../interfaces/flashcard.interfaces';
import { ObjectiveConfidence } from '../utils/user-request.resolver';
import {
  RankedTemplateCandidate,
  selectBestTemplate,
  rankTemplateCandidates,
} from '../utils/template-selection.engine';
import { TemplateRepository } from './template.repository';

export interface SelectTemplateInput {
  ageMin: number;
  ageMax: number;
  ageGroup: string;
  topic: string;
  learningObjective: string;
  objectiveConfidence?: ObjectiveConfidence;
  grade?: string | null;
  subject?: string | null;
  difficulty?: string | null;
  query?: string;
}

export interface SelectTemplateResult {
  learningObjective: string;
  ageMin: number;
  ageMax: number;
  ageGroup: string;
  selection: NonNullable<ReturnType<typeof selectBestTemplate>>;
  template: SelectedTemplatePayload;
  ranking?: RankedTemplateCandidate[];
}

export interface SelectTemplateByIdInput {
  templateId: string;
  learningObjective: string;
  ageMin: number;
  ageMax: number;
  ageGroup: string;
}

@Injectable()
export class TemplateSelectionService {
  constructor(
    private readonly templateRepository: TemplateRepository,
    private readonly configService: ConfigService,
  ) {}

  public async select(input: SelectTemplateInput): Promise<SelectTemplateResult> {
    if (input.ageMin < 0 || input.ageMax < 0 || input.ageMin > input.ageMax) {
      throw new FlashcardException(
        'UNSUPPORTED_AGE',
        'Age range is invalid',
        HttpStatus.BAD_REQUEST,
        { ageMin: input.ageMin, ageMax: input.ageMax },
      );
    }

    const rules = await this.templateRepository.listActiveSelectionRules();

    if (!rules.length) {
      throw new FlashcardException(
        'NO_TEMPLATE_FOUND',
        'No active flashcard templates configured',
        HttpStatus.NOT_FOUND,
      );
    }

    // Topic is intentionally omitted — content only, never template selection.
    const criteria = {
      ageMin: input.ageMin,
      ageMax: input.ageMax,
      ageGroup: input.ageGroup,
      learningObjective: input.learningObjective,
      objectiveConfidence: input.objectiveConfidence,
      grade: input.grade ?? undefined,
      subject: input.subject ?? undefined,
      difficulty: input.difficulty ?? undefined,
    };

    const storeRankingBreakdown =
      this.configService.get<boolean>('pipelineTracking.storeAiPayload') ===
      true;
    const ranking = storeRankingBreakdown
      ? rankTemplateCandidates(rules, criteria)
      : undefined;
    const match = selectBestTemplate(rules, criteria);

    if (!match) {
      throw new FlashcardException(
        'NO_TEMPLATE_FOUND',
        'No template matched the request criteria',
        HttpStatus.NOT_FOUND,
        {
          learningObjective: input.learningObjective,
          ageMin: input.ageMin,
          ageMax: input.ageMax,
          ageGroup: input.ageGroup,
          grade: input.grade,
          subject: input.subject,
          difficulty: input.difficulty,
        },
      );
    }

    const template = await this.templateRepository.getTemplateById(
      match.templateId,
    );
    if (!template) {
      throw new FlashcardException(
        'NO_TEMPLATE_FOUND',
        `Selected template ${match.templateId} no longer exists`,
        HttpStatus.NOT_FOUND,
      );
    }

    if (!template.active) {
      throw new FlashcardException(
        'TEMPLATE_VERSION_MISMATCH',
        `Selected template ${match.templateId} became inactive`,
        HttpStatus.CONFLICT,
        { templateId: match.templateId },
      );
    }

    return {
      learningObjective: input.learningObjective,
      ageMin: input.ageMin,
      ageMax: input.ageMax,
      ageGroup: input.ageGroup,
      selection: match,
      template,
      ranking: ranking?.slice(0, 10),
    };
  }

  public async selectByTemplateId(
    input: SelectTemplateByIdInput,
  ): Promise<SelectTemplateResult> {
    const templateId = input.templateId.trim();
    if (!templateId) {
      throw new FlashcardException(
        'INVALID_REQUEST',
        'templateId is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const template = await this.templateRepository.getTemplateById(templateId);
    if (!template) {
      throw new FlashcardException(
        'NO_TEMPLATE_FOUND',
        `Template ${templateId} was not found`,
        HttpStatus.NOT_FOUND,
        { templateId },
      );
    }

    if (!template.active) {
      throw new FlashcardException(
        'TEMPLATE_VERSION_MISMATCH',
        `Template ${templateId} is inactive`,
        HttpStatus.CONFLICT,
        { templateId },
      );
    }

    return {
      learningObjective: input.learningObjective,
      ageMin: input.ageMin,
      ageMax: input.ageMax,
      ageGroup: input.ageGroup,
      selection: {
        ruleId: `explicit-${templateId}`,
        ruleName: 'Explicit template from request',
        templateId: template.id,
        priority: 0,
        score: 0,
        templateVersion: template.templateVersion,
      },
      template,
    };
  }
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PipelineTelemetryContext } from '../../../common/events/pipeline-tracker.events';
import { FlashcardException } from '../errors/flashcard.exception';
import {
  TemplateSelectionAiFallbackReason,
  TemplateSelectionAiResult,
} from '../interfaces/template-selection-ai.interfaces';
import { SelectedTemplatePayload } from '../interfaces/flashcard.interfaces';
import {
  DimensionConfidence,
  ObjectiveConfidence,
} from '../utils/user-request.resolver';
import {
  RankedTemplateCandidate,
  selectBestTemplate,
  rankTemplateCandidates,
} from '../utils/template-selection.engine';
import { TemplateRepository } from './template.repository';
import { TemplateSelectionAiService } from './template-selection-ai.service';

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
  subjectConfidence?: DimensionConfidence;
  difficultyConfidence?: DimensionConfidence;
  query?: string;
  telemetry?: PipelineTelemetryContext;
}

export interface SelectTemplateResult {
  learningObjective: string;
  ageMin: number;
  ageMax: number;
  ageGroup: string;
  selection: NonNullable<ReturnType<typeof selectBestTemplate>>;
  template: SelectedTemplatePayload;
  ranking?: RankedTemplateCandidate[];
  aiSelection?: {
    usedFallback: boolean;
    fallbackReason?: TemplateSelectionAiFallbackReason;
    result?: TemplateSelectionAiResult | null;
    catalogHash?: string;
    selectionMode: 'ai' | 'deterministic';
  };
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
    private readonly templateSelectionAi: TemplateSelectionAiService,
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

    // Topic is intentionally omitted from hard-filter criteria — content only.
    // Topic is passed to the AI selector for semantic ranking among survivors.
    // query/topic reach the engine solely to unlock opt-in templates.
    const criteria = {
      ageMin: input.ageMin,
      ageMax: input.ageMax,
      ageGroup: input.ageGroup,
      learningObjective: input.learningObjective,
      objectiveConfidence: input.objectiveConfidence,
      grade: input.grade ?? undefined,
      subject: input.subject ?? undefined,
      difficulty: input.difficulty ?? undefined,
      subjectConfidence: input.subjectConfidence,
      difficultyConfidence: input.difficultyConfidence,
      query: input.query ?? undefined,
      topic: input.topic ?? undefined,
    };

    const ranked = rankTemplateCandidates(rules, criteria);
    const deterministic = ranked[0] ?? null;

    if (!deterministic) {
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

    const allowedTemplateIds = [
      ...new Set(ranked.map((candidate) => candidate.templateId)),
    ];
    const nativeTemplateIds = [
      ...new Set(
        ranked
          .filter((candidate) => candidate.breakdown.ageTier >= 3)
          .map((candidate) => candidate.templateId),
      ),
    ];

    const aiOutcome = await this.templateSelectionAi.select({
      topic: input.topic,
      ageGroup: input.ageGroup,
      grade: input.grade,
      subject: input.subject,
      difficulty: input.difficulty,
      learningObjective: input.learningObjective,
      objectiveConfidence: input.objectiveConfidence,
      allowedTemplateIds,
      nativeTemplateIds,
      query: input.query,
      telemetry: input.telemetry,
    });

    let match = deterministic;
    let selectionMode: 'ai' | 'deterministic' = 'deterministic';

    if (!aiOutcome.usedFallback && aiOutcome.result) {
      const aiMatch = ranked.find(
        (candidate) =>
          candidate.templateId === aiOutcome.result!.selectedTemplateId,
      );
      if (aiMatch) {
        match = aiMatch;
        selectionMode = 'ai';
      }
    }

    const storeRankingBreakdown =
      this.configService.get<boolean>('pipelineTracking.storeAiPayload') ===
      true;

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
      selection: {
        ruleId: match.ruleId,
        ruleName: match.ruleName,
        templateId: match.templateId,
        priority: match.priority,
        score: match.score,
        templateVersion: match.templateVersion,
      },
      template,
      ranking: storeRankingBreakdown ? ranked.slice(0, 10) : undefined,
      aiSelection: {
        usedFallback: aiOutcome.usedFallback || selectionMode !== 'ai',
        fallbackReason: aiOutcome.fallbackReason,
        result: aiOutcome.result,
        catalogHash: aiOutcome.catalogHash ?? aiOutcome.result?.catalogHash,
        selectionMode,
      },
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

import { HttpStatus, Injectable } from '@nestjs/common';
import { FlashcardException } from '../errors/flashcard.exception';
import { selectBestTemplate } from '../utils/template-selection.engine';
import { TemplateRepository } from './template.repository';

export interface SelectTemplateInput {
  ageMin: number;
  ageMax: number;
  topic: string;
  learningObjective: string;
  grade?: string | null;
  subject?: string | null;
  difficulty?: string | null;
  query?: string;
}

@Injectable()
export class TemplateSelectionService {
  constructor(private readonly templateRepository: TemplateRepository) {}

  public async select(input: SelectTemplateInput) {
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
    const match = selectBestTemplate(rules, {
      ageMin: input.ageMin,
      ageMax: input.ageMax,
      learningObjective: input.learningObjective,
      grade: input.grade ?? undefined,
      subject: input.subject ?? undefined,
      difficulty: input.difficulty ?? undefined,
    });

    if (!match) {
      throw new FlashcardException(
        'NO_TEMPLATE_FOUND',
        'No template matched the request criteria',
        HttpStatus.NOT_FOUND,
        {
          learningObjective: input.learningObjective,
          ageMin: input.ageMin,
          ageMax: input.ageMax,
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
      selection: match,
      template,
    };
  }
}

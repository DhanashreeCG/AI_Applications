import { HttpStatus, Injectable } from '@nestjs/common';
import { FlashcardException } from '../errors/flashcard.exception';
import { selectBestTemplate } from '../utils/template-selection.engine';
import { TemplateRepository } from './template.repository';

export interface SelectTemplateInput {
  ageMin: number;
  ageMax: number;
  topic: string;
  learningObjective: string;
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
        'No active template selection rules configured',
        HttpStatus.NOT_FOUND,
      );
    }

    const match = selectBestTemplate(rules, {
      topic: input.topic,
      ageMin: input.ageMin,
      ageMax: input.ageMax,
      learningObjective: input.learningObjective,
      intent: input.query,
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
          topic: input.topic,
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

    return {
      learningObjective: input.learningObjective,
      ageMin: input.ageMin,
      ageMax: input.ageMax,
      selection: match,
      template,
    };
  }
}

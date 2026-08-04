import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SelectableRule } from '../utils/template-selection.engine';
import { SelectedTemplatePayload } from '../interfaces/flashcard.interfaces';
import {
  extractLayoutExtras,
  parseAgeGroupBounds,
} from '../utils/template-layout.util';

@Injectable()
export class TemplateRepository {
  constructor(private readonly prisma: PrismaService) {}

  public async listActiveSelectionRules(): Promise<SelectableRule[]> {
    const rules = await this.prisma.templateSelectionRule.findMany({
      where: { active: true },
      include: { template: true },
      orderBy: [{ priority: 'desc' }, { id: 'asc' }],
    });

    return rules.map((rule) => {
      const ageBounds = parseAgeGroupBounds(rule.template.supportedAgeGroups);
      return {
        id: rule.id,
        name: rule.name,
        priority: rule.priority,
        ageMin: rule.ageMin,
        ageMax: rule.ageMax,
        grades: rule.grades,
        subjects: rule.subjects,
        learningObjectives: rule.learningObjectives,
        difficulties: rule.difficulties,
        intents: rule.intents,
        topics: rule.topics,
        templateId: rule.templateId,
        templateActive: rule.template.active,
        templateAgeMin: ageBounds?.min ?? 0,
        templateAgeMax: ageBounds?.max ?? 99,
        templateSubjects: rule.template.subjectsSupported,
        templateObjectives: rule.template.learningObjectives,
        templateDifficulties: rule.template.difficultyLevels,
        templateVersion: rule.template.templateVersion,
      };
    });
  }

  public async getTemplateById(
    templateId: string,
  ): Promise<SelectedTemplatePayload | null> {
    const template = await this.prisma.flashcardTemplate.findUnique({
      where: { id: templateId },
    });
    if (!template) {
      return null;
    }

    const extras = extractLayoutExtras(template.layoutDefinition);

    return {
      id: template.id,
      name: template.name,
      description: template.description,
      templateType: template.templateType,
      layoutType: template.layoutType,
      templateVersion: template.templateVersion,
      supportedAgeGroups: template.supportedAgeGroups,
      supportedGrades: template.supportedGrades,
      learningObjectives: template.learningObjectives,
      subjectsSupported: template.subjectsSupported,
      difficultyLevels: template.difficultyLevels,
      tags: template.tags,
      pageSize: template.pageSize,
      orientation: template.orientation,
      thumbnail: template.thumbnail,
      layoutDefinition: template.layoutDefinition,
      editableComponents: extras.editableComponents,
      componentHierarchy: extras.componentHierarchy,
      componentConstraints: extras.componentConstraints,
      renderingHints: extras.renderingHints,
      defaultStyles: extras.defaultStyles,
    };
  }

  public async countTemplates(): Promise<number> {
    return this.prisma.flashcardTemplate.count();
  }
}

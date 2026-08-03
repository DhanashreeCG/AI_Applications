import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SelectableRule } from '../utils/template-selection.engine';
import { SelectedTemplatePayload } from '../interfaces/flashcard.interfaces';

@Injectable()
export class TemplateRepository {
  constructor(private readonly prisma: PrismaService) {}

  public async listActiveSelectionRules(): Promise<SelectableRule[]> {
    const rules = await this.prisma.templateSelectionRule.findMany({
      where: { active: true },
      include: { template: true },
      orderBy: [{ priority: 'desc' }, { id: 'asc' }],
    });

    return rules.map((rule) => ({
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
      templateAgeMin: rule.template.supportedAgeMin,
      templateAgeMax: rule.template.supportedAgeMax,
      templateSubjects: rule.template.subjectsSupported,
      templateObjectives: rule.template.learningObjectives,
      templateDifficulties: rule.template.difficultyLevels,
      templateVersion: rule.template.templateVersion,
    }));
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

    return {
      id: template.id,
      name: template.name,
      description: template.description,
      templateVersion: template.templateVersion,
      supportedAgeMin: template.supportedAgeMin,
      supportedAgeMax: template.supportedAgeMax,
      learningObjectives: template.learningObjectives,
      layoutDefinition: template.layoutDefinition,
      editableComponents: template.editableComponents,
      componentHierarchy: template.componentHierarchy,
      componentConstraints: template.componentConstraints,
      renderingHints: template.renderingHints,
      defaultStyles: template.defaultStyles,
    };
  }

  public async countTemplates(): Promise<number> {
    return this.prisma.flashcardTemplate.count();
  }
}

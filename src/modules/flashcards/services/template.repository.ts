import { Injectable } from '@nestjs/common';
import { Prisma } from '@generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SelectableRule } from '../utils/template-selection.engine';
import { SelectedTemplatePayload } from '../interfaces/flashcard.interfaces';
import { parseAgeGroupBounds } from '../utils/age-group.util';

@Injectable()
export class TemplateRepository {
  constructor(private readonly prisma: PrismaService) {}

  public async listActiveSelectionRules(): Promise<SelectableRule[]> {
    const [rules, templates] = await Promise.all([
      this.prisma.templateSelectionRule.findMany({
        where: { active: true, template: { active: true } },
        include: { template: true },
        orderBy: [{ priority: 'desc' }, { id: 'asc' }],
      }),
      this.prisma.flashcardTemplate.findMany({
        where: { active: true },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      }),
    ]);

    const selectable = rules.map((rule) =>
      this.ruleToSelectable(rule, rule.template),
    );
    const templatesWithRules = new Set(rules.map((rule) => rule.templateId));

    // A template remains selectable even if no explicit rule was configured.
    // Its own age/objective metadata is sufficient for dynamic selection.
    for (const template of templates) {
      if (!templatesWithRules.has(template.id)) {
        selectable.push(this.templateToSyntheticRule(template));
      }
    }

    return selectable;
  }

  /**
   * Build age/objective wildcard rules from active templates so selection
   * still works when TemplateSelectionRule rows are missing.
   */
  public async synthesizeRulesFromActiveTemplates(): Promise<SelectableRule[]> {
    const templates = await this.prisma.flashcardTemplate.findMany({
      where: { active: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });

    return templates.map((template) =>
      this.templateToSyntheticRule(template),
    );
  }

  private templateToSyntheticRule(template: {
    id: string;
    name: string;
    active: boolean;
    supportedAgeGroups: string[];
    supportedGrades: string[];
    subjectsSupported: string[];
    learningObjectives: string[];
    difficultyLevels: string[];
    templateVersion: string;
  }): SelectableRule {
    const ageBounds = parseAgeGroupBounds(template.supportedAgeGroups);
    return {
      id: `synthetic-${template.id}`,
      name: `Template metadata: ${template.name}`,
      priority: 50,
      ageMin: ageBounds?.min ?? null,
      ageMax: ageBounds?.max ?? null,
      grades: [],
      subjects: [],
      learningObjectives: [],
      difficulties: [],
      intents: [],
      topics: [],
      templateId: template.id,
      templateActive: template.active,
      templateAgeGroups: template.supportedAgeGroups,
      templateAgeMin: ageBounds?.min ?? 0,
      templateAgeMax: ageBounds?.max ?? 99,
      templateSubjects: template.subjectsSupported,
      templateObjectives: template.learningObjectives,
      templateDifficulties: template.difficultyLevels,
      templateVersion: template.templateVersion,
    };
  }

  private ruleToSelectable(
    rule: {
      id: string;
      name: string;
      priority: number;
      ageMin: number | null;
      ageMax: number | null;
      grades: string[];
      subjects: string[];
      learningObjectives: string[];
      difficulties: string[];
      intents: string[];
      topics: string[];
      templateId: string;
    },
    template: {
      active: boolean;
      supportedAgeGroups: string[];
      supportedGrades: string[];
      subjectsSupported: string[];
      learningObjectives: string[];
      difficultyLevels: string[];
      templateVersion: string;
    },
  ): SelectableRule {
    const ageBounds = parseAgeGroupBounds(template.supportedAgeGroups);
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
      templateActive: template.active,
      templateAgeGroups: template.supportedAgeGroups,
      templateAgeMin: ageBounds?.min ?? 0,
      templateAgeMax: ageBounds?.max ?? 99,
      templateSubjects: template.subjectsSupported,
      templateObjectives: template.learningObjectives,
      templateDifficulties: template.difficultyLevels,
      templateVersion: template.templateVersion,
    };
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

    return this.toPayload(template);
  }

  public async createTemplate(input: {
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
  }): Promise<SelectedTemplatePayload> {
    const created = await this.createTemplates([input]);
    return created[0];
  }

  public async createTemplates(
    inputs: Array<{
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
    }>,
  ): Promise<SelectedTemplatePayload[]> {
    const templates = await this.prisma.$transaction(
      inputs.map((input) =>
        this.prisma.flashcardTemplate.create({
          data: {
            // id omitted — Prisma @default(cuid())
            name: input.name,
            description: input.description,
            templateType: input.templateType,
            layoutType: input.layoutType,
            supportedAgeGroups: input.supportedAgeGroups,
            supportedGrades: input.supportedGrades,
            learningObjectives: input.learningObjectives,
            subjectsSupported: input.subjectsSupported,
            difficultyLevels: input.difficultyLevels,
            tags: input.tags,
            pageSize: input.pageSize,
            orientation: input.orientation,
            layoutDefinition: input.layoutDefinition,
            thumbnail: input.thumbnail,
            templateVersion: input.templateVersion,
            active: input.active,
          },
        }),
      ),
    );

    return templates.map((template) => this.toPayload(template));
  }

  public async countTemplates(): Promise<number> {
    return this.prisma.flashcardTemplate.count();
  }

  public async listAllTemplateSummaries(): Promise<
    Array<{
      id: string;
      name: string;
      templateType: string;
      layoutType: string;
    }>
  > {
    return this.prisma.flashcardTemplate.findMany({
      select: {
        id: true,
        name: true,
        templateType: true,
        layoutType: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      where: { active: true },
    });
  }

  private toPayload(template: {
    id: string;
    name: string;
    description: string | null;
    templateType: string;
    layoutType: string;
    templateVersion: string;
    supportedAgeGroups: string[];
    supportedGrades: string[];
    learningObjectives: string[];
    subjectsSupported: string[];
    difficultyLevels: string[];
    tags: string[];
    pageSize: string;
    orientation: string;
    thumbnail: string | null;
    layoutDefinition: unknown;
    active: boolean;
  }): SelectedTemplatePayload {
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
      active: template.active,
    };
  }
}

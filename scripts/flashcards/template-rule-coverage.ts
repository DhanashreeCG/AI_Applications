import { PrismaClient } from '@generated/prisma/client';
import {
  ALL_RULE_SEEDS,
  OBJECTIVE_RULE_SEEDS,
  RULE_SEEDS,
  TEMPLATE_SEEDS,
} from '../../src/modules/flashcards/services/flashcard-seed.service';

const prisma = new PrismaClient();

function parseAgeGroup(value: string): { min: number; max: number } | null {
  const match = value.trim().match(/^(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  return { min: Number(match[1]), max: Number(match[2]) };
}

function overlapsAge(
  ruleAgeMin: number | null,
  ruleAgeMax: number | null,
  targetMin: number,
  targetMax: number,
): boolean {
  if (ruleAgeMin === null || ruleAgeMax === null) return true;
  return ruleAgeMin <= targetMax && ruleAgeMax >= targetMin;
}

function ruleCoversObjective(ruleObjectives: string[], objective: string): boolean {
  if (!ruleObjectives.length) return true;
  return ruleObjectives.includes(objective);
}

async function reportCoverage(): Promise<string[]> {
  const gaps: string[] = [];

  for (const template of TEMPLATE_SEEDS) {
    for (const ageGroup of template.supportedAgeGroups) {
      const parsed = parseAgeGroup(ageGroup);
      if (!parsed) continue;

      for (const objective of template.learningObjectives) {
        const hasRule = ALL_RULE_SEEDS.some(
          (rule) =>
            rule.templateId === template.id &&
            overlapsAge(rule.ageMin, rule.ageMax, parsed.min, parsed.max) &&
            ruleCoversObjective(rule.learningObjectives, objective),
        );

        if (!hasRule) {
          gaps.push(
            `${template.id} @ ${ageGroup} objective=${objective} — no matching TemplateSelectionRule`,
          );
        }
      }
    }
  }

  return gaps;
}

async function applyObjectiveRuleSeeds(): Promise<number> {
  let created = 0;
  for (const rule of OBJECTIVE_RULE_SEEDS) {
    const template = await prisma.flashcardTemplate.findUnique({
      where: { id: rule.templateId },
    });
    if (!template) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping ${rule.id}: template ${rule.templateId} not found`);
      continue;
    }

    await prisma.templateSelectionRule.upsert({
      where: { id: rule.id },
      create: {
        ...rule,
        active: true,
        grades: [],
        subjects: [],
        difficulties: [],
        intents: [],
        topics: [],
      },
      update: {
        name: rule.name,
        priority: rule.priority,
        ageMin: rule.ageMin,
        ageMax: rule.ageMax,
        learningObjectives: rule.learningObjectives,
        active: true,
      },
    });
    created += 1;
  }
  return created;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  // eslint-disable-next-line no-console
  console.log(
    `Catalog: ${TEMPLATE_SEEDS.length} templates, ${RULE_SEEDS.length} age-band rules, ${OBJECTIVE_RULE_SEEDS.length} objective rules`,
  );

  const gaps = await reportCoverage();
  if (!gaps.length) {
    // eslint-disable-next-line no-console
    console.log('No (template, ageGroup, objective) coverage gaps in seed catalog.');
  } else {
    // eslint-disable-next-line no-console
    console.log(`Coverage gaps (${gaps.length}):`);
    for (const gap of gaps) {
      // eslint-disable-next-line no-console
      console.log(`  - ${gap}`);
    }
  }

  if (apply) {
    const created = await applyObjectiveRuleSeeds();
    // eslint-disable-next-line no-console
    console.log(`Upserted ${created} objective-specific TemplateSelectionRule rows.`);
  } else {
    // eslint-disable-next-line no-console
    console.log('Run with --apply to upsert OBJECTIVE_RULE_SEEDS into the database.');
  }
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

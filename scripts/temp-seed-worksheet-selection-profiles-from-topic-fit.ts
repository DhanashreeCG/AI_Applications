/**
 * One-off: compare all worksheet templates with the attached topic-fit JSON
 * and create selection profiles for templates that do not have one.
 *
 * Dry run:
 *   npx ts-node -r tsconfig-paths/register scripts/temp-seed-worksheet-selection-profiles-from-topic-fit.ts --input "C:\\Users\\shubh\\Downloads\\worksheet_templates_topic_fit_updated.json"
 *
 * Apply missing profiles:
 *   npx ts-node -r tsconfig-paths/register scripts/temp-seed-worksheet-selection-profiles-from-topic-fit.ts --input "C:\\Users\\shubh\\Downloads\\worksheet_templates_topic_fit_updated.json" --apply
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createScriptPrismaClient } from './shared/create-script-prisma-client';

interface TopicFitEntry {
  id: string;
  template: {
    templateName: string;
    templateType: string;
    description: string;
  };
  topicFit: {
    primaryUse: string;
    canBeUsedFor: string[];
    exampleTopics: string[];
    adaptationNote: string;
  };
  skillsPracticed: string[];
}

interface TopicFitFile {
  templates: TopicFitEntry[];
}

interface TemplateRow {
  id: string;
  slug: string;
  name: string;
  selectionProfile: { id: string } | null;
}

function getArgument(name: string): string | undefined {
  const prefix = `${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  if (argument) {
    return argument.slice(prefix.length);
  }

  const argumentIndex = process.argv.indexOf(name);
  return argumentIndex >= 0 ? process.argv[argumentIndex + 1] : undefined;
}

function getInputPath(): string {
  const input = getArgument('--input') ?? process.argv[2];
  if (!input || input === '--apply') {
    throw new Error('Provide the JSON file with --input <path>.');
  }
  return resolve(input);
}

function readTopicFitFile(filePath: string): TopicFitFile {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as TopicFitFile;
  if (!Array.isArray(parsed.templates)) {
    throw new Error(`Expected a templates array in ${filePath}.`);
  }
  return parsed;
}

function profileData(entry: TopicFitEntry, templateSlug: string) {
  return {
    templateSlug,
    templateType: entry.template.templateType,
    description: entry.template.description,
    primaryUse: entry.topicFit.primaryUse,
    canBeUsedFor: entry.topicFit.canBeUsedFor ?? [],
    exampleTopics: entry.topicFit.exampleTopics ?? [],
    adaptationNote: entry.topicFit.adaptationNote,
    skillsPracticed: entry.skillsPracticed ?? [],
  };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const inputPath = getInputPath();
  const input = readTopicFitFile(inputPath);
  const prisma = createScriptPrismaClient();

  try {
    const templates = (await prisma.worksheetTemplate.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        selectionProfile: { select: { id: true } },
      },
      orderBy: { slug: 'asc' },
    })) as TemplateRow[];

    const bySlug = new Map(
      templates.map((template) => [template.slug, template]),
    );
    const byName = new Map(
      templates.map((template) => [
        template.name.trim().toLowerCase(),
        template,
      ]),
    );
    const matched = new Map<
      string,
      { entry: TopicFitEntry; template: TemplateRow }
    >();
    const unmatchedJson: Array<{ id: string; templateName: string }> = [];
    const duplicateJson: string[] = [];

    for (const entry of input.templates) {
      const templateName = entry.template?.templateName?.trim();
      if (!templateName) {
        unmatchedJson.push({ id: entry.id, templateName: '(empty)' });
        continue;
      }

      const template =
        bySlug.get(templateName) ?? byName.get(templateName.toLowerCase());
      if (!template) {
        unmatchedJson.push({ id: entry.id, templateName });
        continue;
      }
      if (matched.has(template.id)) {
        duplicateJson.push(templateName);
        continue;
      }
      matched.set(template.id, { entry, template });
    }

    const missing = templates.filter(
      (template) => !template.selectionProfile && matched.has(template.id),
    );
    const missingWithoutJson = templates
      .filter(
        (template) => !template.selectionProfile && !matched.has(template.id),
      )
      .map((template) => ({
        id: template.id,
        slug: template.slug,
        name: template.name,
      }));
    const created: Array<{ id: string; slug: string }> = [];

    if (apply) {
      for (const template of missing) {
        const match = matched.get(template.id)!;
        await prisma.worksheetTemplateSelectionProfile.create({
          data: {
            templateId: template.id,
            ...profileData(match.entry, template.slug),
          },
        });
        created.push({ id: template.id, slug: template.slug });
      }
    }

    console.log(
      JSON.stringify(
        {
          mode: apply ? 'apply' : 'dry-run',
          inputPath,
          databaseTemplateCount: templates.length,
          jsonEntryCount: input.templates.length,
          matchedCount: matched.size,
          profilesAlreadyPresent: templates.filter(
            (template) => template.selectionProfile,
          ).length,
          missingProfilesFromJson: missing.map((template) => ({
            id: template.id,
            slug: template.slug,
            name: template.name,
          })),
          created,
          unmatchedJson,
          duplicateJson,
          missingProfilesWithoutJson: missingWithoutJson,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

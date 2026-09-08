/**
 * Idempotent seed for WorksheetTemplateSelectionProfile from docs/worksheet/seed-data.json.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/seed-worksheet-template-selection-profiles.ts
 *
 * Mismatch overrides (optional — fill before run to link flagged JSON slugs):
 *   edit MANUAL_SLUG_OVERRIDES in worksheet-selection-profile-seed.util.ts
 * Default: skip-and-warn for number_names_matching / look_and_say_letter_sounds.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createScriptPrismaClient } from './shared/create-script-prisma-client';
import {
  AUTHORITATIVE_TEMPLATE_IDS,
  MANUAL_SLUG_OVERRIDES,
  resolveAuthoritativeSlug,
} from '../src/modules/worksheets/utils/worksheet-selection-profile-seed.util';

export {
  AUTHORITATIVE_TEMPLATE_IDS,
  MANUAL_SLUG_OVERRIDES,
  resolveAuthoritativeSlug,
};

interface SeedEntry {
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

interface SeedFile {
  templates: SeedEntry[];
}

async function main(): Promise<void> {
  const fixturePath = resolve(__dirname, '../docs/worksheet/seed-data.json');
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8')) as SeedFile;
  const prisma = createScriptPrismaClient();

  let created = 0;
  let updated = 0;
  const skipped: Array<{ jsonSlug: string; reason: string }> = [];
  const seededSlugs = new Set<string>();

  try {
    for (const entry of raw.templates ?? []) {
      const jsonSlug = entry.template?.templateName?.trim();
      if (!jsonSlug) {
        skipped.push({ jsonSlug: '(missing)', reason: 'entry missing template.templateName' });
        continue;
      }

      const resolved = resolveAuthoritativeSlug(jsonSlug);
      if ('skip' in resolved) {
        console.warn(`[skip] ${resolved.reason}`);
        skipped.push({ jsonSlug, reason: resolved.reason });
        continue;
      }

      const templateId = AUTHORITATIVE_TEMPLATE_IDS[resolved.slug];
      const existing = await prisma.worksheetTemplate.findUnique({
        where: { id: templateId },
        select: { id: true, slug: true },
      });
      if (!existing) {
        const reason = `authoritative id ${templateId} not found in DB for slug=${resolved.slug}`;
        console.warn(`[skip] ${reason}`);
        skipped.push({ jsonSlug, reason });
        continue;
      }
      if (existing.slug !== resolved.slug) {
        const reason = `DB slug drift: expected ${resolved.slug}, found ${existing.slug} for id=${templateId}`;
        console.warn(`[skip] ${reason}`);
        skipped.push({ jsonSlug, reason });
        continue;
      }

      const data = {
        templateSlug: existing.slug,
        templateType: entry.template.templateType,
        description: entry.template.description,
        primaryUse: entry.topicFit.primaryUse,
        canBeUsedFor: entry.topicFit.canBeUsedFor ?? [],
        exampleTopics: entry.topicFit.exampleTopics ?? [],
        adaptationNote: entry.topicFit.adaptationNote,
        skillsPracticed: entry.skillsPracticed ?? [],
      };

      const prior = await prisma.worksheetTemplateSelectionProfile.findUnique({
        where: { templateId },
        select: { id: true },
      });

      await prisma.worksheetTemplateSelectionProfile.upsert({
        where: { templateId },
        create: { templateId, ...data },
        update: data,
      });

      seededSlugs.add(existing.slug);
      if (prior) {
        updated += 1;
      } else {
        created += 1;
      }
    }

    const missingProfiles = Object.keys(AUTHORITATIVE_TEMPLATE_IDS).filter(
      (slug) => !seededSlugs.has(slug),
    );

    console.log(
      JSON.stringify(
        {
          created,
          updated,
          skipped,
          authoritativeSlugsMissingProfile: missingProfiles,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

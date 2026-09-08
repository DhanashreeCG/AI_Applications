/**
 * Seed selection profiles for worksheet templates that still lack one.
 *
 * Covers:
 * - number_names ← seed-data.json `number_names_matching` (confirmed link)
 * - look_and_say_letters_and_sounds ← seed-data.json `look_and_say_letter_sounds`
 * - storytime_maze ← authored from WorksheetTemplate.meta (no JSON entry)
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/seed-missing-worksheet-template-selection-profiles.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createScriptPrismaClient } from './shared/create-script-prisma-client';
import {
  AUTHORITATIVE_TEMPLATE_IDS,
  buildStorytimeMazeSelectionProfile,
  CONFIRMED_JSON_SLUG_LINKS,
  profilePayloadFromSeedEntry,
  resolveAuthoritativeSlug,
} from '../src/modules/worksheets/utils/worksheet-selection-profile-seed.util';

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
  let skippedAlreadyPresent = 0;
  const skipped: Array<{ slug: string; reason: string }> = [];
  const seeded: string[] = [];

  try {
    const missing = await prisma.worksheetTemplate.findMany({
      where: { selectionProfile: null },
      select: {
        id: true,
        slug: true,
        name: true,
        category: true,
        description: true,
        meta: true,
      },
      orderBy: { slug: 'asc' },
    });

    console.log(
      `Found ${missing.length} template(s) without selectionProfile: ${missing
        .map((t) => t.slug)
        .join(', ') || '(none)'}`,
    );

    const byAuthoritativeId = new Map(
      Object.entries(AUTHORITATIVE_TEMPLATE_IDS).map(([slug, id]) => [id, slug]),
    );

    // 1) Link confirmed mismatch JSON entries → missing authoritative templates
    for (const entry of raw.templates ?? []) {
      const jsonSlug = entry.template?.templateName?.trim();
      if (!jsonSlug || !(jsonSlug in CONFIRMED_JSON_SLUG_LINKS)) {
        continue;
      }

      const resolved = resolveAuthoritativeSlug(jsonSlug, CONFIRMED_JSON_SLUG_LINKS);
      if ('skip' in resolved) {
        skipped.push({ slug: jsonSlug, reason: resolved.reason });
        continue;
      }

      const templateId = AUTHORITATIVE_TEMPLATE_IDS[resolved.slug];
      const row = missing.find((t) => t.id === templateId);
      if (!row) {
        skippedAlreadyPresent += 1;
        skipped.push({
          slug: resolved.slug,
          reason: 'already has selectionProfile or not in DB missing set',
        });
        continue;
      }

      const data = profilePayloadFromSeedEntry(entry, row.slug);
      const prior = await prisma.worksheetTemplateSelectionProfile.findUnique({
        where: { templateId },
        select: { id: true },
      });
      await prisma.worksheetTemplateSelectionProfile.upsert({
        where: { templateId },
        create: { templateId, ...data },
        update: data,
      });
      seeded.push(row.slug);
      if (prior) updated += 1;
      else created += 1;
    }

    // 2) storytime_maze (and any other missing with no JSON) — derive from DB meta
    for (const row of missing) {
      if (seeded.includes(row.slug)) {
        continue;
      }

      if (row.slug === 'storytime_maze' || byAuthoritativeId.get(row.id) === 'storytime_maze') {
        const data = buildStorytimeMazeSelectionProfile(row);
        const prior = await prisma.worksheetTemplateSelectionProfile.findUnique({
          where: { templateId: row.id },
          select: { id: true },
        });
        await prisma.worksheetTemplateSelectionProfile.upsert({
          where: { templateId: row.id },
          create: { templateId: row.id, ...data },
          update: data,
        });
        seeded.push(row.slug);
        if (prior) updated += 1;
        else created += 1;
        continue;
      }

      skipped.push({
        slug: row.slug,
        reason:
          'no confirmed seed payload — add to seed-data.json or extend this script',
      });
    }

    const stillMissing = await prisma.worksheetTemplate.findMany({
      where: { selectionProfile: null },
      select: { slug: true },
      orderBy: { slug: 'asc' },
    });

    console.log(
      JSON.stringify(
        {
          created,
          updated,
          skippedAlreadyPresent,
          seeded,
          skipped,
          stillMissingProfiles: stillMissing.map((t) => t.slug),
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

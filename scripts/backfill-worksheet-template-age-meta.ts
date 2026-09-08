/**
 * One-off: flag ACTIVE worksheet templates missing ageMin/ageMax,
 * and backfill from grades when the grade→age mapping is unambiguous.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-worksheet-template-age-meta.ts
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-worksheet-template-age-meta.ts --apply
 */
import { GRADE_TO_AGE_BAND } from '../src/modules/worksheets/constants/worksheet-template-taxonomy.constants';
import { WorksheetTemplateMeta } from '../src/modules/worksheets/types/worksheet.types';
import { createScriptPrismaClient } from './shared/create-script-prisma-client';

function parseMeta(raw: unknown): WorksheetTemplateMeta {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return raw as WorksheetTemplateMeta;
}

function resolveAgeFromGrades(grades: string[] | undefined): { min: number; max: number } | null {
  if (!grades?.length) {
    return null;
  }
  const bands: Array<{ min: number; max: number }> = [];
  for (const grade of grades) {
    const key = grade.trim().toLowerCase();
    const mapped = GRADE_TO_AGE_BAND[key];
    if (!mapped) {
      return null; // ambiguous / unknown grade → skip auto-backfill
    }
    bands.push(mapped);
  }
  if (!bands.length) {
    return null;
  }
  return {
    min: Math.min(...bands.map((b) => b.min)),
    max: Math.max(...bands.map((b) => b.max)),
  };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const prisma = createScriptPrismaClient();

  try {
    const templates = await prisma.worksheetTemplate.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, slug: true, name: true, meta: true },
    });

    const missing: Array<{ slug: string; id: string }> = [];
    const backfilled: Array<{ slug: string; ageMin: number; ageMax: number }> = [];
    const stillMissing: Array<{ slug: string; reason: string }> = [];

    for (const row of templates) {
      const meta = parseMeta(row.meta);
      const hasAge =
        typeof meta.ageMin === 'number' &&
        Number.isFinite(meta.ageMin) &&
        typeof meta.ageMax === 'number' &&
        Number.isFinite(meta.ageMax);

      if (hasAge) {
        continue;
      }

      missing.push({ slug: row.slug, id: row.id });
      const fromGrades = resolveAgeFromGrades(meta.grades);
      if (!fromGrades) {
        stillMissing.push({
          slug: row.slug,
          reason: meta.grades?.length
            ? 'grades present but not unambiguously mapped'
            : 'no grades to infer age from',
        });
        continue;
      }

      const nextMeta: WorksheetTemplateMeta = {
        ...meta,
        ageMin: fromGrades.min,
        ageMax: fromGrades.max,
      };
      backfilled.push({
        slug: row.slug,
        ageMin: fromGrades.min,
        ageMax: fromGrades.max,
      });

      if (apply) {
        await prisma.worksheetTemplate.update({
          where: { id: row.id },
          data: { meta: nextMeta as object },
        });
      }
    }

    console.log(
      JSON.stringify(
        {
          mode: apply ? 'apply' : 'dry-run',
          activeCount: templates.length,
          missingAgeMetaCount: missing.length,
          wouldBackfill: backfilled,
          needsManualAge: stillMissing,
        },
        null,
        2,
      ),
    );

    if (!apply && backfilled.length) {
      console.log('\nRe-run with --apply to write ageMin/ageMax for the backfill candidates.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/**
 * Review-only: suggest theme / subTopics / activityType for ACTIVE templates
 * from name, description, and existing topics. Prints suggestions — does NOT apply.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/suggest-worksheet-template-taxonomy.ts
 */
import {
  FS0_TAXONOMY,
  FS1_TAXONOMY,
  FS2_TAXONOMY,
  WORKSHEET_ACTIVITY_TYPES,
  TaxonomyTheme,
} from '../src/modules/worksheets/constants/worksheet-template-taxonomy.constants';
import { WorksheetTemplateMeta } from '../src/modules/worksheets/types/worksheet.types';
import { createScriptPrismaClient } from './shared/create-script-prisma-client';

function parseMeta(raw: unknown): WorksheetTemplateMeta {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return raw as WorksheetTemplateMeta;
}

function taxonomyForTemplateAge(ageMin?: number, ageMax?: number): TaxonomyTheme[] {
  if (ageMin == null || ageMax == null) {
    return [...FS0_TAXONOMY, ...FS1_TAXONOMY, ...FS2_TAXONOMY];
  }
  const mid = (ageMin + ageMax) / 2;
  if (mid < 3) return FS0_TAXONOMY;
  if (mid < 4) return FS1_TAXONOMY;
  if (mid <= 5) return FS2_TAXONOMY;
  return [];
}

function scoreMatch(haystack: string, needle: string): number {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (!n) return 0;
  if (h === n) return 3;
  if (h.includes(n) || n.includes(h)) return 2;
  const tokens = n.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const hits = tokens.filter((t) => h.includes(t)).length;
  return hits > 0 ? hits / tokens.length : 0;
}

function suggestThemeSubTopics(
  text: string,
  taxonomy: TaxonomyTheme[],
): { theme: string | null; subTopics: string[] } {
  if (!taxonomy.length) {
    return { theme: null, subTopics: [] };
  }

  let bestTheme: TaxonomyTheme | null = null;
  let bestScore = 0;
  for (const theme of taxonomy) {
    let score = scoreMatch(text, theme.theme);
    for (const sub of theme.subTopics) {
      score = Math.max(score, scoreMatch(text, sub) * 1.1);
    }
    if (score > bestScore) {
      bestScore = score;
      bestTheme = theme;
    }
  }

  if (!bestTheme || bestScore < 0.5) {
    return { theme: null, subTopics: [] };
  }

  const subTopics = bestTheme.subTopics
    .map((sub) => ({ sub, score: scoreMatch(text, sub) }))
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.sub);

  return { theme: bestTheme.theme, subTopics };
}

function suggestActivityTypes(text: string): string[] {
  return WORKSHEET_ACTIVITY_TYPES.map((activity) => ({
    activity,
    score: scoreMatch(text, activity),
  }))
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.activity);
}

async function main(): Promise<void> {
  const prisma = createScriptPrismaClient();

  try {
    const templates = await prisma.worksheetTemplate.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        meta: true,
      },
    });

    const suggestions = templates.map((row) => {
      const meta = parseMeta(row.meta);
      const text = [row.name, row.description ?? '', ...(meta.topics ?? [])]
        .join(' ')
        .trim();
      const taxonomy = taxonomyForTemplateAge(meta.ageMin, meta.ageMax);
      const { theme, subTopics } = suggestThemeSubTopics(text, taxonomy);
      const activityType = suggestActivityTypes(text);

      return {
        slug: row.slug,
        id: row.id,
        current: {
          theme: meta.theme ?? null,
          subTopics: meta.subTopics ?? [],
          activityType: meta.activityType ?? [],
          topics: meta.topics ?? [],
          ageMin: meta.ageMin ?? null,
          ageMax: meta.ageMax ?? null,
        },
        suggested: {
          theme,
          subTopics,
          activityType,
        },
        note: 'Review before applying — this script never writes to the DB.',
      };
    });

    console.log(JSON.stringify({ count: suggestions.length, suggestions }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

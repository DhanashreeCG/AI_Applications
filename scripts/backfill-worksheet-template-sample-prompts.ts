/**
 * Idempotent backfill of WorksheetTemplate.samplePrompt from
 * docs/worksheet/sample_prompts.json.
 *
 * Match order: templateId, then templateSlug.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-worksheet-template-sample-prompts.ts
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-worksheet-template-sample-prompts.ts --apply
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createScriptPrismaClient } from './shared/create-script-prisma-client';

interface SamplePromptEntry {
  templateId?: string;
  templateSlug?: string;
  prompt?: string;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const prisma = createScriptPrismaClient();

  try {
    const filePath = resolve(__dirname, '../docs/worksheet/sample_prompts.json');
    const entries = JSON.parse(readFileSync(filePath, 'utf8')) as SamplePromptEntry[];
    if (!Array.isArray(entries)) {
      throw new Error('sample_prompts.json must be a JSON array');
    }

    const updated: Array<{ id: string; slug: string; matchedBy: string }> = [];
    const skipped: Array<{ templateId?: string; templateSlug?: string; reason: string }> = [];
    const missing: Array<{ templateId?: string; templateSlug?: string }> = [];

    for (const entry of entries) {
      const prompt = typeof entry.prompt === 'string' ? entry.prompt.trim() : '';
      if (!prompt) {
        skipped.push({
          templateId: entry.templateId,
          templateSlug: entry.templateSlug,
          reason: 'empty prompt',
        });
        continue;
      }

      let row =
        entry.templateId
          ? await prisma.worksheetTemplate.findUnique({
              where: { id: entry.templateId },
              select: { id: true, slug: true, samplePrompt: true },
            })
          : null;
      let matchedBy = 'templateId';

      if (!row && entry.templateSlug) {
        row = await prisma.worksheetTemplate.findUnique({
          where: { slug: entry.templateSlug },
          select: { id: true, slug: true, samplePrompt: true },
        });
        matchedBy = 'templateSlug';
      }

      if (!row) {
        missing.push({
          templateId: entry.templateId,
          templateSlug: entry.templateSlug,
        });
        continue;
      }

      if (row.samplePrompt === prompt) {
        skipped.push({
          templateId: row.id,
          templateSlug: row.slug,
          reason: 'already up to date',
        });
        continue;
      }

      updated.push({ id: row.id, slug: row.slug, matchedBy });
      if (apply) {
        await prisma.worksheetTemplate.update({
          where: { id: row.id },
          data: { samplePrompt: prompt },
        });
      }
    }

    console.log(
      JSON.stringify(
        {
          mode: apply ? 'apply' : 'dry-run',
          entryCount: entries.length,
          wouldUpdate: updated,
          skipped,
          missing,
        },
        null,
        2,
      ),
    );

    if (!apply && updated.length) {
      console.log('\nRe-run with --apply to write samplePrompt values.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

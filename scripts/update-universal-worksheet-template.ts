/**
 * Patch Universal Template shell + config in DB (no public PATCH API).
 * Usage: npx ts-node -r tsconfig-paths/register scripts/update-universal-worksheet-template.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createScriptPrismaClient } from './shared/create-script-prisma-client';

const TEMPLATE_ID = 'cmtveqj0x002ltobgwe7d4brc';
const SLUG = 'universal_template';

async function main(): Promise<void> {
  const prisma = createScriptPrismaClient();
  const assetsDir = join(process.cwd(), 'docs', 'worksheet', 'assets');
  const html = readFileSync(join(assetsDir, 'universal_template.html'), 'utf8');
  const structure = JSON.parse(
    readFileSync(join(assetsDir, 'universal_template.structure.json'), 'utf8'),
  ) as object;
  const metaPack = JSON.parse(
    readFileSync(join(assetsDir, 'universal_template.meta.json'), 'utf8'),
  ) as Record<string, unknown>;

  const updated = await prisma.worksheetTemplate.update({
    where: { id: TEMPLATE_ID },
    data: {
      templateHtml: html,
      structureDefinition: structure,
      rendererConfig: metaPack.rendererConfig as object,
      meta: metaPack.meta as object,
      fieldPrompts: metaPack.fieldPrompts as object,
      aiConfig: metaPack.aiConfig as object,
      aiSystemPrompt: String(metaPack.aiSystemPrompt ?? ''),
      samplePrompt: String(metaPack.samplePrompt ?? ''),
      description: String(metaPack.description ?? ''),
    },
  });

  console.log(
    JSON.stringify(
      {
        id: updated.id,
        slug: updated.slug,
        updatedAt: updated.updatedAt,
        expectedSlug: SLUG,
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});

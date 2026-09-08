/**
 * Flags WorksheetTemplateSelectionProfile rows whose templateSlug no longer
 * matches the linked WorksheetTemplate.slug.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/check-worksheet-selection-profile-slug-drift.ts
 */
import { createScriptPrismaClient } from './shared/create-script-prisma-client';

async function main(): Promise<void> {
  const prisma = createScriptPrismaClient();
  try {
    const rows = await prisma.worksheetTemplateSelectionProfile.findMany({
      select: {
        id: true,
        templateId: true,
        templateSlug: true,
        template: { select: { slug: true } },
      },
    });

    const drifted = rows.filter((row) => row.templateSlug !== row.template.slug);
    console.log(
      JSON.stringify(
        {
          checked: rows.length,
          driftedCount: drifted.length,
          drifted: drifted.map((row) => ({
            profileId: row.id,
            templateId: row.templateId,
            profileSlug: row.templateSlug,
            templateSlug: row.template.slug,
          })),
        },
        null,
        2,
      ),
    );
    if (drifted.length) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

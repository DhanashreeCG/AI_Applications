import { createScriptPrismaClient } from './shared/create-script-prisma-client';

const prisma = createScriptPrismaClient();

async function main() {
  const template = await prisma.worksheetTemplate.findFirst({
    where: { slug: 'circle_the_words' },
  });
  if (!template) {
    console.log('circle_the_words not found');
    return;
  }
  const structure = (template.structureDefinition ?? {}) as Record<string, unknown>;
  const aiConfig = {
    ...((structure.ai_config as object) ?? {}),
    editable_fields: structure.editable_fields ?? {},
    aiEditable: Array.isArray((structure.ai_config as { ai_editable?: string[] })?.ai_editable)
      ? (structure.ai_config as { ai_editable: string[] }).ai_editable
      : ['topic', 'instruction_text', 'sight_word_bank', 'rows'],
  };
  await prisma.worksheetTemplate.update({
    where: { id: template.id },
    data: { aiConfig },
  });
  console.log(`Updated aiConfig for circle_the_words id=${template.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

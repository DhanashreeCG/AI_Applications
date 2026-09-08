import { createScriptPrismaClient } from './shared/create-script-prisma-client';

const prisma = createScriptPrismaClient();

function cleanNumberNamesHtml(html: string): string {
  let next = html.replace(/<\/body>\s*<\/html>\s*<\/body>\s*<\/html>/gi, '</body></html>');
  next = next.replace(/<\/html>\s*<\/html>/gi, '</html>');
  if (!/\{\{\s*NUMBERS\s*\}\}/i.test(next)) {
    next = next.replace(/<\/body>/i, '{{NUMBERS}}\n{{NAMES}}\n</body>');
  }
  if (!/\.name-item\{[^}]*font-size/i.test(next)) {
    next = next.replace(
      /(\.name-item\{[^}]*)(font-weight:700)/i,
      '$1font-size:28px;$2',
    );
  }
  return next;
}

async function main() {
  const template = await prisma.worksheetTemplate.findFirst({
    where: { slug: 'number_names' },
  });
  if (!template) {
    console.log('number_names template not found');
    return;
  }

  const templateHtml = cleanNumberNamesHtml(template.templateHtml);
  await prisma.worksheetTemplate.update({
    where: { id: template.id },
    data: { templateHtml },
  });
  console.log(`Updated number_names template html id=${template.id} length=${templateHtml.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

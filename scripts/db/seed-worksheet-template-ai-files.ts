import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createScriptPrismaClient } from '../shared/create-script-prisma-client';

const DEFAULT_TEMPLATES_ROOT =
  'C:\\Users\\shubh\\Downloads\\WorksheetMakerMain_localhost-20260813T065743Z-1-001\\WorksheetMakerMain_localhost\\backend\\templates';

const SLUG_ALIASES: Record<string, string[]> = {
  answer_and_colour: ['answer_and_colour', 'answer-and-colour'],
  circle_the_words: ['circle_the_words'],
  circle_the_things: ['circle_the_things'],
  match_the_pairs: ['match_the_pairs', 'matching'],
  number_names: ['number_names'],
};

const FILE_TO_FIELD = {
  'ai-edit-config.js': 'aiEditConfigJs',
  'ai-edit-popup.html': 'aiEditPopupHtml',
  'ai-edit-panel.js': 'aiEditPanelJs',
  'editor.js': 'editorJs',
  'field-editor.js': 'fieldEditorJs',
  'renderer.js': 'rendererJs',
  'ai-edit-system-prompt.txt': 'aiSystemPrompt',
} as const;

async function listTemplateDirs(root: string): Promise<string[]> {
  const dirs: string[] = [];
  for (const category of await readdir(root, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    const categoryPath = join(root, category.name);
    for (const template of await readdir(categoryPath, { withFileTypes: true })) {
      if (template.isDirectory()) {
        dirs.push(join(categoryPath, template.name));
      }
    }
  }
  return dirs;
}

function folderSlug(dir: string): string {
  return dir.split(/[/\\]/).pop()!.trim().toLowerCase();
}

async function readOptional(path: string): Promise<string | null> {
  if (!existsSync(path)) return null;
  const text = (await readFile(path, 'utf8')).trim();
  return text.length ? text : null;
}

async function main() {
  const root = process.env.WORKSHEET_TEMPLATES_ROOT?.trim() || DEFAULT_TEMPLATES_ROOT;
  if (!existsSync(root)) {
    throw new Error(`Templates root not found: ${root}`);
  }

  const prisma = createScriptPrismaClient();
  try {
    const dbTemplates = await prisma.worksheetTemplate.findMany({
      select: { id: true, slug: true, name: true },
    });
    const bySlug = new Map(dbTemplates.map((t) => [t.slug, t]));
    console.log(`DB templates: ${dbTemplates.map((t) => t.slug).join(', ') || '(none)'}`);

    const dirs = await listTemplateDirs(root);
    for (const dir of dirs) {
      const slug = folderSlug(dir);
      const candidates = SLUG_ALIASES[slug] ?? [slug];
      const match = candidates.map((s) => bySlug.get(s)).find(Boolean);
      if (!match) {
        console.log(`SKIP ${slug} — no matching WorksheetTemplate (${candidates.join(', ')})`);
        continue;
      }

      const data: Record<string, unknown> = {};
      for (const [fileName, field] of Object.entries(FILE_TO_FIELD)) {
        const content = await readOptional(join(dir, fileName));
        if (content) data[field] = content;
      }

      const fieldPromptsRaw = await readOptional(join(dir, 'field-prompts.json'));
      if (fieldPromptsRaw) {
        data.fieldPrompts = JSON.parse(fieldPromptsRaw);
      }

      if (!Object.keys(data).length) {
        console.log(`SKIP ${match.slug} — no AI/editor files in ${dir}`);
        continue;
      }

      await prisma.worksheetTemplate.update({
        where: { id: match.id },
        data,
      });
      console.log(`UPDATED ${match.slug} (${match.id}) fields=${Object.keys(data).join(', ')}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/**
 * Creates the Universal Template via POST /worksheets/templates.
 * Usage: npx ts-node -r tsconfig-paths/register scripts/create-universal-worksheet-template.ts [baseUrl]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

async function main(): Promise<void> {
  const baseUrl = (process.argv[2] || process.env.API_BASE_URL || 'http://localhost:5000').replace(
    /\/$/,
    '',
  );
  const assetsDir = join(process.cwd(), 'docs', 'worksheet', 'assets');
  const html = readFileSync(join(assetsDir, 'universal_template.html'), 'utf8');
  const structure = readFileSync(
    join(assetsDir, 'universal_template.structure.json'),
    'utf8',
  );
  const metaPack = JSON.parse(
    readFileSync(join(assetsDir, 'universal_template.meta.json'), 'utf8'),
  ) as Record<string, unknown>;
  const background = readFileSync(
    join(assetsDir, 'universal_template_background.png'),
  );

  const form = new FormData();
  form.append('name', String(metaPack.name));
  form.append('slug', String(metaPack.slug));
  form.append('category', String(metaPack.category));
  form.append('description', String(metaPack.description ?? ''));
  form.append('status', String(metaPack.status ?? 'ACTIVE'));
  form.append('version', String(metaPack.version ?? 1));
  form.append('rendererType', String(metaPack.rendererType ?? 'generic'));
  form.append('templateHtml', html);
  form.append('structureDefinition', structure);
  form.append('rendererConfig', JSON.stringify(metaPack.rendererConfig ?? {}));
  form.append('meta', JSON.stringify(metaPack.meta ?? {}));
  form.append('aiConfig', JSON.stringify(metaPack.aiConfig ?? {}));
  form.append('fieldPrompts', JSON.stringify(metaPack.fieldPrompts ?? {}));
  form.append('aiSystemPrompt', String(metaPack.aiSystemPrompt ?? ''));
  form.append('samplePrompt', String(metaPack.samplePrompt ?? ''));
  form.append(
    'background',
    new Blob([background], { type: 'image/png' }),
    'universal_template_background.png',
  );
  form.append(
    'sample',
    new Blob([background], { type: 'image/png' }),
    'universal_template_sample.png',
  );

  const res = await fetch(`${baseUrl}/worksheets/templates`, {
    method: 'POST',
    body: form,
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    console.error('Create failed', res.status, body);
    process.exit(1);
  }
  console.log(JSON.stringify(body, null, 2));
  const id =
    body && typeof body === 'object' && 'id' in body
      ? String((body as { id: string }).id)
      : '';
  if (id) {
    writeFileSync(
      join(assetsDir, 'universal_template.created.json'),
      JSON.stringify(body, null, 2),
      'utf8',
    );
    console.log(`\nSaved id=${id} to docs/worksheet/assets/universal_template.created.json`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { createScriptPrismaClient } from './shared/create-script-prisma-client';

const prisma = createScriptPrismaClient();

const CONNECTOR_DOT_CSS = `
.nn-connect-dot{position:absolute;width:12px;height:12px;border-radius:50%;border:2px solid #e89aa6;background:#fff;box-sizing:border-box;pointer-events:none;z-index:5;}
.nn-connect-dot-right{right:-6px;top:50%;transform:translateY(-50%);}
.nn-connect-dot-left{left:-6px;top:50%;transform:translateY(-50%);}
.number-item.nn-circle,.name-item.nn-pill{position:absolute;}
`;

function ensureConnectorDotCss(html: string): string {
  if (/\.nn-connect-dot\s*\{/i.test(html)) {
    return html;
  }
  if (/<\/style>/i.test(html)) {
    return html.replace(/<\/style>/i, `${CONNECTOR_DOT_CSS}</style>`);
  }
  return html.replace(/<head([^>]*)>/i, `<head$1><style>${CONNECTOR_DOT_CSS}</style>`);
}

export function cleanNumberNamesHtml(html: string): string {
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
  next = ensureConnectorDotCss(next);
  return next;
}

function patchAiEditConfigJs(source: string | null | undefined): string | null {
  if (!source?.trim()) {
    return source ?? null;
  }
  let next = source;
  next = next.replace(
    /Pick 6 unique numbers between 1 and 20\.?/gi,
    'Pick 3 to 6 unique numbers between 1 and 6 by default. If the user wants a broader or random set, pick from 0 to 20.',
  );
  next = next.replace(
    /Pick 6 unique numbers between/gi,
    'Pick 3 to 6 unique numbers between',
  );
  next = next.replace(
    /Pick 6 values from this range/gi,
    'Pick 3 to 6 values from this range',
  );
  next = next.replace(
    /Only use the first 6 values\s*[—-]\s*the worksheet has exactly 6 rows\.?/gi,
    'Use 3 to 6 values — the worksheet supports 3 to 6 rows (never more than 6).',
  );
  next = next.replace(
    /The worksheet has 6 rows[^.]*\.?/gi,
    'The worksheet has 3 to 6 rows (min 3, max 6).',
  );
  // Stop padding short specific lists up to 6 with filler values.
  next = next.replace(
    /add \$\{6\s*-\s*count\} more UNIQUE values that fit the same range and match type\.?/gi,
    'use EXACTLY those ${count} values as pairs (one each). Do NOT pad to 6 and never repeat a number.',
  );
  next = next.replace(
    /Since only \$\{count\} specific value\(s\) were provided,\s*`\s*\+\s*`add[^`]+/gi,
    'Since ${count} specific value(s) were provided, use EXACTLY those ${count} values as pairs (one each). Do NOT pad to 6 and never repeat a number.` + `',
  );
  // Range branch: honor contiguous spans like 1-4 as exact pair counts.
  next = next.replace(
    /Pick 3 to 6 values from this range\/set:\s*"\$\{range\}"\.\s*`\s*\+\s*`All 6 must be unique[^.]*\.?/gi,
    'For range/set "${range}": if it is a contiguous span of 3–6 numbers (e.g. 1-4), emit EXACTLY that many pairs covering each value once — do NOT pad to 6. If the span is larger than 6, pick 6 unique values from it. Never repeat a number.',
  );
  next = next.replace(
    /All 6 must be unique\s*[—-]\s*spread across the range, not clustered\.?/gi,
    'Every left-column number must be unique. For a contiguous span of 3–6 (e.g. 1-4), use exactly that many pairs — do not pad to 6.',
  );
  next = next.replace(/exactly 6 (pairs|rows|entries)/gi, '3 to 6 $1');
  next = next.replace(/Pick 6 /gi, 'Pick 3 to 6 ');
  return next;
}

function patchAiSystemPrompt(source: string | null | undefined): string | null {
  if (!source?.trim()) {
    return source ?? null;
  }
  let next = source;
  next = next.replace(
    /Fixed\s+"pairs"\s+array with EXACTLY 6 entries\.?/gi,
    'Fixed "pairs" array with 3 to 6 entries (min 3, max 6).',
  );
  next = next.replace(
    /Fixed\s+"pairs"\s+array with 3 to 6 entries \(min 3, max 6\)\.?/gi,
    'Fixed "pairs" array with 3 to 6 entries (min 3, max 6). Every left-column number must be UNIQUE — never repeat a number to fill rows. If the user gives range 1-4, emit exactly 4 pairs.',
  );
  next = next.replace(
    /EXACTLY 6 pairs\s*[—-]\s*never more, never fewer\.?/gi,
    '3 to 6 pairs — never fewer than 3, never more than 6.',
  );
  next = next.replace(
    /unique across all 6 pairs/gi,
    'unique across all pairs',
  );
  next = next.replace(
    /between 1 and 20/gi,
    'between 1 and 6 by default, or 0 and 20 when a broader/random set is requested',
  );
  next = next.replace(/exactly 6/gi, '3 to 6');
  if (!/never repeat a number/i.test(next)) {
    next +=
      '\n\nCRITICAL: Never repeat left-column numbers to pad to 6 rows. Contiguous ranges of size 3–6 (e.g. 1-4) must produce exactly that many pairs.\n';
  }
  return next;
}

function patchAiEditPopupHtml(source: string | null | undefined): string | null {
  if (!source?.trim()) {
    return source ?? null;
  }
  let next = source;
  next = next.replace(
    /Leave range and specific numbers blank\s*[→\-–]\s*AI picks 6 suitable values automatically\.?/gi,
    'Leave range and specific numbers blank → AI picks 3–6 values from 1–6 by default (or 0–20 when a broader/random set is requested).',
  );
  next = next.replace(/picks 6 suitable/gi, 'picks 3–6 suitable');
  next = next.replace(/exactly 6/gi, '3 to 6');
  return next;
}

function patchStructureDefinition(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw;
  }
  const structure = { ...(raw as Record<string, unknown>) };
  if (isRecord(structure.layout)) {
    structure.layout = {
      ...structure.layout,
      row_count: 6,
    };
  }
  if (Array.isArray(structure.pairs) && structure.pairs.length > 0) {
    const existingPairs = structure.pairs as unknown[];
    const defaults = [
      { id: 'pair_1', number: '1', name: 'one', color: '#F8D7DA' },
      { id: 'pair_2', number: '2', name: 'two', color: '#D1E9F6' },
      { id: 'pair_3', number: '3', name: 'three', color: '#E2EFD9' },
      { id: 'pair_4', number: '4', name: 'four', color: '#E2D9F3' },
      { id: 'pair_5', number: '5', name: 'five', color: '#FFF2CC' },
      { id: 'pair_6', number: '6', name: 'six', color: '#FAD7C4' },
    ];
    structure.pairs = defaults.map((pair, index) => {
      const existing = isRecord(existingPairs[index])
        ? existingPairs[index]
        : {};
      return {
        ...existing,
        ...pair,
        editable: existing.editable ?? true,
      };
    });
  }
  return structure;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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
  const aiEditConfigJs = patchAiEditConfigJs(template.aiEditConfigJs);
  const aiSystemPrompt = patchAiSystemPrompt(template.aiSystemPrompt);
  const aiEditPopupHtml = patchAiEditPopupHtml(template.aiEditPopupHtml);
  const structureDefinition = patchStructureDefinition(template.structureDefinition);

  await prisma.worksheetTemplate.update({
    where: { id: template.id },
    data: {
      templateHtml,
      ...(aiEditConfigJs != null ? { aiEditConfigJs } : {}),
      ...(aiSystemPrompt != null ? { aiSystemPrompt } : {}),
      ...(aiEditPopupHtml != null ? { aiEditPopupHtml } : {}),
      structureDefinition: structureDefinition as object,
    },
  });
  console.log(
    `Updated number_names template id=${template.id} html=${templateHtml.length} aiEdit=${!!aiEditConfigJs} prompt=${!!aiSystemPrompt}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

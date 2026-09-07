import { createScriptPrismaClient } from './shared/create-script-prisma-client';

const prisma = createScriptPrismaClient();

type Box = { left: number; top: number; width: number; height: number };

/**
 * Image zones inset inside the blue (section 1) and yellow (section 2)
 * capsules. Same pair = same square size and same top (1:1, vertically
 * aligned). Left/right columns centered on x≈252 / x≈764.
 * Pairs 1–2 sit 15px lower than the original prototype tops.
 */
const IMAGE_ZONES: Record<string, Box> = {
  '1_left': { left: 205, top: 370, width: 95, height: 95 },
  '1_right': { left: 717, top: 370, width: 95, height: 95 },
  '2_left': { left: 187, top: 520, width: 130, height: 130 },
  '2_right': { left: 699, top: 520, width: 130, height: 130 },
  '3_left': { left: 187, top: 885, width: 130, height: 130 },
  '3_right': { left: 699, top: 885, width: 130, height: 130 },
  '4_left': { left: 205, top: 1090, width: 95, height: 95 },
  '4_right': { left: 717, top: 1090, width: 95, height: 95 },
};

function boxStyle(box: Box): string {
  return `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;`;
}

export function cleanTracingHtml(html: string): string {
  let next = html;

  for (const [key, box] of Object.entries(IMAGE_ZONES)) {
    const [n, side] = key.split('_');
    const idRe = `selectPairImage\\(\\s*['"]pair_${n}['"]\\s*,\\s*['"]${side}['"]\\s*\\)`;

    next = next.replace(
      new RegExp(
        `(<div\\s+class="img-zone-box"[\\s\\S]{0,160}?${idRe}[\\s\\S]{0,80}?style=")[^"]*(")`,
        'i',
      ),
      `$1${boxStyle(box)}$2`,
    );

    next = next.replace(
      new RegExp(
        `(<button\\s+class="img-camera-btn"[\\s\\S]{0,160}?${idRe}[\\s\\S]{0,80}?style=")[^"]*(")`,
        'i',
      ),
      `$1left:${box.left + box.width - 28}px;top:${box.top + box.height - 22}px;$2`,
    );

    // If static img tags were previously baked in, resize those too.
    const slotToken = `IMAGE_${n}_${side.toUpperCase()}`;
    next = next.replace(
      new RegExp(
        `(<img\\s+class="worksheet-image"[^>]*(?:data-image-slot="(?:${slotToken}|pairs\\[${Number(n) - 1}\\]\\.${side}_image)")[^>]*style=")[^"]*(")`,
        'i',
      ),
      `$1${boxStyle(box)}z-index:2;$2`,
    );
  }

  return next;
}

async function main() {
  const template = await prisma.worksheetTemplate.findFirst({
    where: { slug: 'tracing' },
  });
  if (!template) {
    console.log('tracing template not found');
    return;
  }

  const templateHtml = cleanTracingHtml(template.templateHtml);
  await prisma.worksheetTemplate.update({
    where: { id: template.id },
    data: { templateHtml },
  });
  console.log(`Updated tracing html id=${template.id} length=${templateHtml.length}`);

  for (const [key, box] of Object.entries(IMAGE_ZONES)) {
    const [n, side] = key.split('_');
    const re = new RegExp(
      `selectPairImage\\(\\s*['"]pair_${n}['"]\\s*,\\s*['"]${side}['"]\\s*\\)[\\s\\S]{0,120}?style="([^"]+)"`,
      'i',
    );
    const m = templateHtml.match(re);
    console.log(`pair_${n} ${side}:`, m?.[1] || 'MISSING', 'expected', boxStyle(box));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

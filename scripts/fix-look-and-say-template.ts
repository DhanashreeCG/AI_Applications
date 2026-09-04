import { createScriptPrismaClient } from './shared/create-script-prisma-client';

const prisma = createScriptPrismaClient();

type Box = { left: number; top: number; width: number; height: number };

/**
 * Measured from the background artwork (768x1024 stretched to the 1016x1316
 * canvas): the green ring covers x 324-690 / y 479-835. Image zones must stay
 * clear of that rect, otherwise pictures cover the letter circle.
 */
const CIRCLE: Box = { left: 324, top: 479, width: 366, height: 356 };

const IMAGE_ZONES: Record<number, Box> = {
  1: { left: 55, top: 245, width: 265, height: 230 },
  2: { left: 696, top: 245, width: 265, height: 230 },
  3: { left: 55, top: 700, width: 265, height: 275 },
  4: { left: 696, top: 700, width: 265, height: 275 },
};

const IMAGE_Z_INDEX = 2;

function setCssProp(
  html: string,
  selector: string,
  prop: string,
  value: string,
): string {
  const block = new RegExp(`(${selector}\\s*\\{)([^}]*)(\\})`, 'i');
  return html.replace(block, (_full, open: string, body: string, close: string) => {
    const propRe = new RegExp(`(\\s*)${prop}\\s*:\\s*[^;}]*;?`, 'i');
    if (propRe.test(body)) {
      return `${open}${body.replace(propRe, `$1${prop}: ${value};`)}${close}`;
    }
    return `${open}${body}\n  ${prop}: ${value};${close}`;
  });
}

function boxStyle(box: Box, extra = ''): string {
  return `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;${extra}`;
}

function replaceZoneStyle(html: string, n: number): string {
  const box = IMAGE_ZONES[n];
  const idRe = `selectWorksheetImage\\(\\s*['"]item_${n}['"]\\s*\\)`;

  // dashed bounding box overlay
  let next = html.replace(
    new RegExp(
      `(<div\\s+class="img-zone-box"[\\s\\S]{0,120}?${idRe}[\\s\\S]{0,60}?style=")[^"]*(")`,
      'i',
    ),
    `$1${boxStyle(box)}$2`,
  );

  // camera button pinned to the bottom-right corner of the zone
  next = next.replace(
    new RegExp(
      `(<button\\s+class="img-camera-btn"[\\s\\S]{0,120}?${idRe}[\\s\\S]{0,60}?style=")[^"]*(")`,
      'i',
    ),
    `$1left:${box.left + box.width - 30}px;top:${box.top + box.height - 25}px;$2`,
  );

  // rendered picture
  next = next.replace(
    new RegExp(
      `(<img\\s+class="worksheet-image"[^>]*data-image-slot="item_${n}"[^>]*style=")[^"]*(")`,
      'i',
    ),
    `$1${boxStyle(box, `z-index:${IMAGE_Z_INDEX};`)}$2`,
  );

  return next;
}

export function cleanLookAndSayHtml(html: string): string {
  let next = html;

  // stacking order: background < pictures < captions < letter circle
  next = setCssProp(next, '\\.worksheet-bg', 'z-index', '0');
  next = setCssProp(next, '\\.worksheet-image', 'z-index', String(IMAGE_Z_INDEX));
  next = setCssProp(next, '\\.caption', 'z-index', '6');
  next = setCssProp(next, '\\.topic', 'z-index', '6');
  next = setCssProp(next, '\\.badge', 'z-index', '6');
  next = setCssProp(next, '\\.instruction-pill', 'z-index', '6');

  // centre the letters on the measured ring centre (507, 657)
  next = setCssProp(next, '\\.center-circle', 'left', `${CIRCLE.left}px`);
  next = setCssProp(next, '\\.center-circle', 'top', `${CIRCLE.top}px`);
  next = setCssProp(next, '\\.center-circle', 'width', `${CIRCLE.width}px`);
  next = setCssProp(next, '\\.center-circle', 'height', `${CIRCLE.height}px`);
  next = setCssProp(next, '\\.center-circle', 'align-items', 'center');
  next = setCssProp(next, '\\.center-circle', 'justify-content', 'center');
  next = setCssProp(next, '\\.center-circle', 'gap', '12px');
  next = setCssProp(next, '\\.center-circle', 'white-space', 'nowrap');
  next = setCssProp(next, '\\.center-circle', 'line-height', '1');
  next = setCssProp(next, '\\.center-circle', 'z-index', '8');
  // em sizes so the template's shrink-to-fit can scale wide letters (W, M)
  next = setCssProp(next, '\\.center-circle', 'font-size', '196px');
  next = setCssProp(next, '\\.letter-upper', 'font-size', '1em');
  next = setCssProp(next, '\\.letter-lower', 'font-size', '0.9em');

  // keep the target-letter pencil off the circle
  next = next.replace(
    /(data-pencil-for="target_letter"[\s\S]{0,80}?style=")[^"]*(")/i,
    '$1top:486px;left:700px;$2',
  );

  for (const n of [1, 2, 3, 4]) {
    const slotRe = new RegExp(`data-image-slot=["']item_${n}["']`, 'i');
    const tokenRe = new RegExp(`\\{\\{\\s*IMAGE_${n}\\s*\\}\\}`, 'gi');
    const box = IMAGE_ZONES[n];
    if (slotRe.test(next)) {
      next = next.replace(tokenRe, '');
    } else {
      next = next.replace(
        tokenRe,
        `<img class="worksheet-image" data-image-slot="item_${n}" data-field-path="items[${n - 1}]" alt="" style="${boxStyle(box, `z-index:${IMAGE_Z_INDEX};`)}" />`,
      );
    }
    next = replaceZoneStyle(next, n);
  }

  return next;
}

async function main() {
  const template = await prisma.worksheetTemplate.findFirst({
    where: { slug: 'look_and_say_letters_and_sounds' },
  });
  if (!template) {
    console.log('look_and_say_letters_and_sounds template not found');
    return;
  }

  const templateHtml = cleanLookAndSayHtml(template.templateHtml);
  await prisma.worksheetTemplate.update({
    where: { id: template.id },
    data: { templateHtml },
  });
  console.log(
    `Updated look_and_say_letters_and_sounds html id=${template.id} length=${templateHtml.length}`,
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

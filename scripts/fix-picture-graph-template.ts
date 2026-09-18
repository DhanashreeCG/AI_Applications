import { createScriptPrismaClient } from './shared/create-script-prisma-client';

const prisma = createScriptPrismaClient();

const COUNT_ANSWER_CSS = `
.count-answer-box{position:absolute;width:140px;height:70px;border:2.5px dashed #8ec8e8;border-radius:8px;background:rgba(255,255,255,0.55);box-sizing:border-box;z-index:4;}
.pg-mesh-root{position:absolute;inset:0;pointer-events:none;}
.graph-bars-container{position:absolute;inset:0;}
`;

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

function ensureStyleBlock(html: string, css: string, marker: string): string {
  if (html.includes(marker)) {
    return html;
  }
  if (/<\/style>/i.test(html)) {
    return html.replace(/<\/style>/i, `${css}</style>`);
  }
  return html.replace(/<head([^>]*)>/i, `<head$1><style>${css}</style>`);
}

/**
 * Ensure {{GRAPH_MESH_HTML}} exists and remove hardcoded y-axis digits so the
 * mesh builder owns labels (avoids double numbering after bg mesh removal).
 */
export function cleanPictureGraphHtml(html: string): string {
  let next = html;

  next = ensureStyleBlock(next, COUNT_ANSWER_CSS, '.count-answer-box{');

  // Prefer dashed answer boxes from CSS (bg no longer paints them).
  if (/\.count-answer-box\s*\{/i.test(next)) {
    next = next.replace(
      /(\.count-answer-box\s*\{)([^}]*)(\})/i,
      (_full, open: string, body: string, close: string) => {
        let updated = body;
        if (!/border\s*:/i.test(updated)) {
          updated += 'border:2.5px dashed #8ec8e8;';
        } else {
          updated = updated.replace(
            /border\s*:\s*[^;]+;?/i,
            'border:2.5px dashed #8ec8e8;',
          );
        }
        if (!/border-radius\s*:/i.test(updated)) {
          updated += 'border-radius:8px;';
        }
        if (!/background\s*:/i.test(updated)) {
          updated += 'background:rgba(255,255,255,0.55);';
        }
        if (!/box-sizing\s*:/i.test(updated)) {
          updated += 'box-sizing:border-box;';
        }
        return `${open}${updated}${close}`;
      },
    );
  }

  // Keep mesh/bars above the background image.
  next = next.replace(
    /(\.graph-bars-container\s*\{)([^}]*)(\})/i,
    (_full, open: string, body: string, close: string) => {
      let updated = body;
      if (!/z-index\s*:/i.test(updated)) {
        updated += 'z-index:5;';
      } else {
        updated = updated.replace(/z-index\s*:\s*[^;]+;?/i, 'z-index:5;');
      }
      if (!/position\s*:/i.test(updated)) {
        updated += 'position:absolute;';
      }
      return `${open}${updated}${close}`;
    },
  );

  // Only nudge the instruction slightly below the header; leave graph chrome as-is.
  next = setCssProp(next, '\\.instruction-container', 'top', '220px');
  // Restore prior mistaken shifts if present.
  next = setCssProp(next, '\\.graph-column-icons', 'top', '720px');
  next = setCssProp(next, '\\.bottom-section', 'top', '1040px');

  if (!/\{\{\s*GRAPH_MESH_HTML\s*\}\}/i.test(next)) {
    if (/graph-bars-container/i.test(next)) {
      next = next.replace(
        /(<(?:div|section)[^>]*class=["'][^"']*\bgraph-bars-container\b[^"']*["'][^>]*>)/i,
        '$1{{GRAPH_MESH_HTML}}',
      );
    } else if (/\{\{\s*GRAPH_BARS_HTML\s*\}\}/i.test(next)) {
      next = next.replace(
        /\{\{\s*GRAPH_BARS_HTML\s*\}\}/i,
        '{{GRAPH_MESH_HTML}}{{GRAPH_BARS_HTML}}',
      );
    } else {
      next = next.replace(
        /<\/body>/i,
        '<div class="graph-bars-container">{{GRAPH_MESH_HTML}}{{GRAPH_BARS_HTML}}</div></body>',
      );
    }
  }

  // Remove static y-axis number nodes if present (mesh builder draws 1..yMax).
  next = next.replace(
    /<div[^>]*class=["'][^"']*\by-axis(?:-container|-label|)\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
    '',
  );
  // Fallback: strip lone absolute y-tick digits that look like axis labels.
  next = next.replace(
    /<div[^>]*class=["'][^"']*\by-tick\b[^"']*["'][^>]*>\s*\d{1,2}\s*<\/div>/gi,
    '',
  );

  return next;
}

async function main() {
  const template = await prisma.worksheetTemplate.findFirst({
    where: { slug: 'picture_graph' },
  });
  if (!template) {
    console.log('picture_graph template not found');
    return;
  }

  const templateHtml = cleanPictureGraphHtml(template.templateHtml);
  await prisma.worksheetTemplate.update({
    where: { id: template.id },
    data: { templateHtml },
  });
  console.log(
    `Updated picture_graph template html id=${template.id} length=${templateHtml.length} hasMeshToken=${/\{\{\s*GRAPH_MESH_HTML\s*\}\}/i.test(templateHtml)}`,
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

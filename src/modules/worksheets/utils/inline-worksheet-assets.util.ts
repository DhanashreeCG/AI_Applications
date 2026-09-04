const DEFAULT_ASSET_IMAGE_PATH = '/worksheets/assets';

export function assetImageUrlPattern(assetImagePath = DEFAULT_ASSET_IMAGE_PATH): RegExp {
  const path = assetImagePath.replace(/\/$/, '') || DEFAULT_ASSET_IMAGE_PATH;
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?:https?:\\/\\/[^"'\\s)]+)?${escaped}\\/([A-Za-z0-9_-]+)\\/image`,
    'g',
  );
}

export function collectAssetIdsFromHtml(
  html: string,
  assetImagePath = DEFAULT_ASSET_IMAGE_PATH,
): string[] {
  const ids = new Set<string>();
  const pattern = assetImageUrlPattern(assetImagePath);
  for (const match of html.matchAll(pattern)) {
    if (match[1]) {
      ids.add(match[1]);
    }
  }
  return [...ids];
}

export function replaceAssetUrlsWithDataUris(
  html: string,
  dataUris: Map<string, string>,
  assetImagePath = DEFAULT_ASSET_IMAGE_PATH,
): string {
  if (!dataUris.size) {
    return html;
  }
  return html.replace(assetImageUrlPattern(assetImagePath), (full, assetId: string) => {
    return dataUris.get(assetId) ?? full;
  });
}

export const WORKSHEET_CAPTURE_CSS = `<style data-worksheet-capture="true">
@font-face{font-family:'Toondemy';src:url('/fonts/TOONDEMY%20FONTS.TTF') format('truetype');font-weight:100 900;font-style:normal;font-display:swap;}
html,body{background:#ffffff;font-family:'Toondemy',sans-serif !important;}
*{ font-family:'Toondemy',sans-serif !important; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
</style>`;

export function injectCaptureCss(html: string): string {
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${WORKSHEET_CAPTURE_CSS}</head>`);
  }
  return `${WORKSHEET_CAPTURE_CSS}${html}`;
}

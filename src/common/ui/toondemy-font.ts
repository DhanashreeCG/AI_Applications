export const TOONDEMY_FONT_FAMILY = 'Toondemy';
export const TOONDEMY_FONT_PATH = '/fonts/TOONDEMY%20FONTS.TTF';

/** Join a public/ path onto an origin (Nest or shared static host). */
export function joinPublicAssetUrl(baseUrl = '', path: string): string {
  const trimmed = (path || '').trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/^(https?:|data:|blob:)/i.test(trimmed)) {
    return trimmed;
  }
  const base = baseUrl.replace(/\/$/, '');
  const suffix = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${base}${suffix}`;
}

export function toondemyFontUrl(apiBaseUrl = ''): string {
  return joinPublicAssetUrl(apiBaseUrl, TOONDEMY_FONT_PATH);
}

export function toondemyFontFaceCss(fontUrl = TOONDEMY_FONT_PATH): string {
  return `@font-face{font-family:'Toondemy';src:url('${fontUrl}') format('truetype');font-weight:100 900;font-style:normal;font-display:swap;}`;
}

export function toondemyTextCss(fontUrl = TOONDEMY_FONT_PATH): string {
  return `${toondemyFontFaceCss(fontUrl)}html,body,button,input,select,textarea,h1,h2,h3,h4,h5,h6,p,span,div,label,li,td,th{font-family:'Toondemy',sans-serif !important;}`;
}

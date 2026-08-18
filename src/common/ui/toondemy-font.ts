export const TOONDEMY_FONT_FAMILY = 'Toondemy';
export const TOONDEMY_FONT_PATH = '/fonts/TOONDEMY%20FONTS.TTF';

export function toondemyFontUrl(apiBaseUrl = ''): string {
  const base = apiBaseUrl.replace(/\/$/, '');
  return `${base}${TOONDEMY_FONT_PATH}`;
}

export function toondemyFontFaceCss(fontUrl = TOONDEMY_FONT_PATH): string {
  return `@font-face{font-family:'Toondemy';src:url('${fontUrl}') format('truetype');font-weight:100 900;font-style:normal;font-display:swap;}`;
}

export function toondemyTextCss(fontUrl = TOONDEMY_FONT_PATH): string {
  return `${toondemyFontFaceCss(fontUrl)}html,body,button,input,select,textarea,h1,h2,h3,h4,h5,h6,p,span,div,label,li,td,th{font-family:'Toondemy',sans-serif !important;}`;
}

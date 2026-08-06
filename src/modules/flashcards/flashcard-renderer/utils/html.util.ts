const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] ?? char);
}

export function renderAttributes(
  attributes: Record<string, string | number | boolean | undefined | null>,
): string {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => ` ${key}="${escapeHtml(String(value))}"`)
    .join('');
}

export function renderElement(
  tag: string,
  attributes: Record<string, string | number | boolean | undefined | null>,
  innerHtml = '',
): string {
  if (!innerHtml) {
    return `<${tag}${renderAttributes(attributes)} />`;
  }

  return `<${tag}${renderAttributes(attributes)}>${innerHtml}</${tag}>`;
}

export function renderDocument(params: {
  title: string;
  css: string;
  bodyHtml: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(params.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700;800&family=Nunito:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>${params.css}</style>
</head>
<body>
${params.bodyHtml}
</body>
</html>`;
}

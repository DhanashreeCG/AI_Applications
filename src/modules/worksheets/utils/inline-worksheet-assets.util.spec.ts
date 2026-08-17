import {
  collectAssetIdsFromHtml,
  injectCaptureCss,
  replaceAssetUrlsWithDataUris,
} from './inline-worksheet-assets.util';

describe('inline-worksheet-assets', () => {
  it('collects relative and absolute worksheet asset ids', () => {
    const html = `
      <img src="/worksheets/assets/bg-1/image" />
      <img src="https://dev.example/worksheets/assets/main-9/image" />
    `;
    expect(collectAssetIdsFromHtml(html)).toEqual(['bg-1', 'main-9']);
  });

  it('replaces collected urls with data uris', () => {
    const html =
      '<img src="/worksheets/assets/bg-1/image" /><img src="http://localhost:5000/worksheets/assets/main-9/image" />';
    const next = replaceAssetUrlsWithDataUris(
      html,
      new Map([
        ['bg-1', 'data:image/png;base64,aaa'],
        ['main-9', 'data:image/webp;base64,bbb'],
      ]),
    );
    expect(next).toContain('src="data:image/png;base64,aaa"');
    expect(next).toContain('src="data:image/webp;base64,bbb"');
    expect(next).not.toContain('/worksheets/assets/');
  });

  it('injects capture CSS before closing head', () => {
    const html = injectCaptureCss('<html><head></head><body></body></html>');
    expect(html).toContain('data-worksheet-capture');
    expect(html).toContain('print-color-adjust:exact');
  });
});

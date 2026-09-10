import {
  buildUniversalSkeletonHtml,
  normalizeImgTagsToImageTokens,
  normalizeUniversalStructure,
  sanitizeUniversalContentHtml,
} from './universal-content-html.util';

describe('universal strict dynamic HTML', () => {
  it('normalizes headers and images without imposing a layout catalog', () => {
    const next = normalizeUniversalStructure({
      topic: 'Animal Homes',
      sub_topic: 'Where do animals live?',
      instruction_text: 'Match each animal.',
      content_html: '<div>{{IMAGE_1}}{{IMAGE_2}}</div>',
      layout: 'match_grid',
      items: [{ title: 'x' }],
    });
    expect(next.main_topic).toBe('Animal Homes');
    expect(next.sub_topic).toBe('Practice');
    expect(next.layout).toBeUndefined();
    expect(next.items).toBeUndefined();
    expect((next.images as unknown[]).length).toBe(2);
  });

  it('converts img src="{{IMAGE_N}}" to bare tokens before sanitize', () => {
    const html = normalizeImgTagsToImageTokens(
      `<div><img src="{{IMAGE_1}}" alt="Bear" style="width:80px" /></div>`,
    );
    expect(html).toBe('<div>{{IMAGE_1}}</div>');
  });

  it('builds dynamic fragment with expanded image slots', () => {
    const html = buildUniversalSkeletonHtml({
      main_topic: 'Animal Homes',
      sub_topic: 'Science',
      instruction_text: 'Explore animal homes.',
      content_html:
        '<div style="display:flex;flex-direction:column;gap:16px;height:100%;">' +
        '<div style="display:flex;gap:12px;flex:1;">{{IMAGE_1}}<p>Bear cave</p></div>' +
        '<div style="display:flex;gap:12px;flex:1;"><img src="{{IMAGE_2}}" alt="Bird" /></div>' +
        '</div>',
      images: [
        { imageQuery: 'cartoon bear' },
        { imageQuery: 'cartoon bird nest' },
      ],
    });
    expect(html).toContain('class="ws-dynamic"');
    expect(html).toContain('data-image-slot="images[0]"');
    expect(html).toContain('data-image-slot="images[1]"');
    expect(html).not.toContain('src="{{IMAGE');
    expect(html).not.toContain('ws-match');
    expect(html).not.toContain('layout-steps');
  });

  it('strips scripts from freeform HTML', () => {
    const html = sanitizeUniversalContentHtml(
      `<div onclick="x()"><p>Hi</p><script>evil()</script>{{IMAGE_1}}</div>`,
    );
    expect(html).toContain('<p>Hi</p>');
    expect(html).toContain('{{IMAGE_1}}');
    expect(html).not.toContain('script');
    expect(html).not.toContain('onclick');
  });
});

import {
  buildUniversalSkeletonHtml,
  fitUniversalContentLayout,
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
    expect(html).toContain('aspect-ratio:1/1');
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

  it('unwraps height:100% root and tags bordered sections so last outline can close', () => {
    const fitted = fitUniversalContentLayout(
      `<div style="display:flex;flex-direction:column;gap:10px;height:100%;overflow:hidden;width:100%;">` +
        `<div style="border:3px solid #85cbf4;border-radius:14px;padding:10px;">Learn</div>` +
        `<div style="border:3px solid #67bd47;border-radius:14px;padding:10px;">Match</div>` +
        `<div style="border:3px solid #f03a3e;border-radius:14px;padding:10px;">Circle</div>` +
        `</div>`,
    );
    expect(fitted).not.toMatch(/height\s*:\s*100%/i);
    expect(fitted).toContain('ws-section');
    expect(fitted.match(/ws-section/g)?.length).toBe(3);
    expect(fitted).toMatch(/flex:1 1 0/);
    expect(fitted).toMatch(/min-height:0/);
    expect(fitted).toMatch(/box-sizing:border-box/);
  });

  it('keeps a complete border-bottom when only side borders are set', () => {
    const fitted = fitUniversalContentLayout(
      `<section style="border-top:3px solid #f03a3e;border-left:3px solid #f03a3e;border-right:3px solid #f03a3e;padding:8px;">Q</section>`,
    );
    expect(fitted).toMatch(/border-bottom:3px solid #f03a3e/i);
    expect(fitted).toContain('ws-section');
  });

  it('injects instruction without leaving a height:100% sibling stack', () => {
    const html = buildUniversalSkeletonHtml({
      main_topic: 'Animal Sounds',
      sub_topic: 'Listen',
      instruction_text: 'Match the animals to their sounds.',
      content_html:
        `<div style="height:100%;overflow:hidden;display:flex;flex-direction:column;">` +
        `<div style="border:2px solid #85cbf4;">A</div>` +
        `<div style="border:2px solid #f03a3e;">B</div>` +
        `</div>`,
      images: [{ imageQuery: 'cat' }, { imageQuery: 'dog' }],
    });
    expect(html).toContain('ws-instruction');
    expect(html).toContain('ws-section');
    // Host .ws-dynamic may use height:100%; activity markup must not.
    expect(html).not.toMatch(/ws-section[^>]*height\s*:\s*100%/i);
    expect(html).not.toMatch(/ws-stack[^>]*height\s*:\s*100%/i);
    const withoutHost = html.replace(
      /<div class="ws-dynamic"[^>]*>/,
      '',
    );
    expect(withoutHost).not.toMatch(/height\s*:\s*100%/i);
  });
});

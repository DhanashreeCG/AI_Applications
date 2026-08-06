import { escapeHtml, renderElement } from './html.util';
import { resolveImageSource } from './image-source.util';
import { resolvePageDimensions } from './page-dimensions.util';

describe('html.util', () => {
  it('escapes unsafe HTML characters', () => {
    expect(escapeHtml(`Tom & Jerry's "fun"`)).toBe(
      'Tom &amp; Jerry&#39;s &quot;fun&quot;',
    );
  });

  it('renders semantic elements with attributes', () => {
    expect(
      renderElement('div', { class: 'c-title', id: 'title_word' }, 'Apple'),
    ).toBe('<div class="c-title" id="title_word">Apple</div>');
  });
});

describe('image-source.util', () => {
  it('prefers imageUrl and resolves relative paths against api base', () => {
    const source = resolveImageSource(
      {
        assetId: 'asset-1',
        s3ObjectKey: 'key',
        signedUrl: 'https://signed.example/image',
        imageUrl: '/flashcards/assets/asset-1/image',
        caption: null,
        similarity: 0.9,
        mimeType: 'image/png',
        status: 'found',
        queryUsed: 'apple',
        attempts: [],
      },
      'http://localhost:3000',
    );

    expect(source).toBe('http://localhost:3000/flashcards/assets/asset-1/image');
  });

  it('falls back to signedUrl when imageUrl is missing', () => {
    const source = resolveImageSource(
      {
        assetId: null,
        s3ObjectKey: null,
        signedUrl: 'https://signed.example/image',
        imageUrl: null,
        caption: null,
        similarity: null,
        mimeType: null,
        status: 'not_found',
        queryUsed: '',
        attempts: [],
      },
      'http://localhost:3000',
    );

    expect(source).toBe('https://signed.example/image');
  });
});

describe('page-dimensions.util', () => {
  it('returns portrait dimensions by default', () => {
    expect(resolvePageDimensions('A6', 'PORTRAIT')).toEqual({
      width: 900,
      height: 1200,
    });
  });

  it('swaps dimensions for landscape orientation', () => {
    expect(resolvePageDimensions('A6', 'LANDSCAPE')).toEqual({
      width: 1200,
      height: 900,
    });
  });
});

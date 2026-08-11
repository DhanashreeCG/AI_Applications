import { hashSourceText } from './source-text-hash.util';

describe('hashSourceText', () => {
  it('should produce a stable SHA-256 hash for normalized text', () => {
    const first = hashSourceText('  red cat on sofa  ');
    const second = hashSourceText('red cat on sofa');

    expect(first).toBe(second);
    expect(first).toHaveLength(64);
  });
});

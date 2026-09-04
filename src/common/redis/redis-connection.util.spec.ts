import { normalizeBullMqPrefix } from './redis-connection.util';

describe('normalizeBullMqPrefix', () => {
  it('wraps a plain prefix in a Redis hash tag', () => {
    expect(normalizeBullMqPrefix('asset-ingestion')).toBe('{asset-ingestion}');
  });

  it('does not double-wrap an already tagged prefix', () => {
    expect(normalizeBullMqPrefix('{asset-ingestion}')).toBe('{asset-ingestion}');
  });

  it('uses the default when empty', () => {
    expect(normalizeBullMqPrefix('')).toBe('{asset-ingestion}');
  });
});

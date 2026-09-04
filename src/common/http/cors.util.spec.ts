import { buildCorsOptions } from './cors.util';

describe('buildCorsOptions', () => {
  it('reflects any origin when allowAll is true', () => {
    const options = buildCorsOptions({
      origins: [],
      allowAll: true,
      credentials: false,
    });

    expect(options.origin).toBe(true);
  });

  it('allows listed origins and same-origin requests without Origin', () => {
    const options = buildCorsOptions({
      origins: ['https://gyan-academy.creativegalileo.com'],
      allowAll: false,
      credentials: false,
    });
    const originFn = options.origin as (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => void;

    originFn('https://gyan-academy.creativegalileo.com', (_err, allow) => {
      expect(allow).toBe(true);
    });
    originFn('https://evil.example', (_err, allow) => {
      expect(allow).toBe(false);
    });
    originFn(undefined, (_err, allow) => {
      expect(allow).toBe(true);
    });
  });
});

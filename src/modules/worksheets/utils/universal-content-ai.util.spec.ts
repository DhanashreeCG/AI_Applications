import {
  inferUniversalContentProviderFromModel,
  normalizeUniversalContentProvider,
  resolveUniversalContentRoute,
} from './universal-content-ai.util';

describe('universal content AI route', () => {
  it('normalizes provider aliases', () => {
    expect(normalizeUniversalContentProvider('openai')).toBe('openai');
    expect(normalizeUniversalContentProvider('OpenAI')).toBe('openai');
    expect(normalizeUniversalContentProvider('gemini')).toBe('gemini');
    expect(normalizeUniversalContentProvider('google-gemini')).toBe('gemini');
    expect(normalizeUniversalContentProvider('')).toBeNull();
  });

  it('infers provider from model id', () => {
    expect(inferUniversalContentProviderFromModel('gpt-4.1-mini')).toBe(
      'openai',
    );
    expect(inferUniversalContentProviderFromModel('o3-mini')).toBe('openai');
    expect(inferUniversalContentProviderFromModel('gemini-2.5-pro')).toBe(
      'gemini',
    );
  });

  it('prefers env provider + matching model', () => {
    expect(
      resolveUniversalContentRoute({
        envProvider: 'openai',
        envOpenaiModel: 'gpt-4o',
        configuredGeminiModel: 'gemini-2.5-pro',
        fallbackGeminiModel: 'gemini-2.5-flash',
      }),
    ).toEqual({ provider: 'openai', model: 'gpt-4o' });

    expect(
      resolveUniversalContentRoute({
        envProvider: 'gemini',
        envGeminiModel: 'gemini-3.1-pro-preview',
        envOpenaiModel: 'gpt-4o',
        fallbackGeminiModel: 'gemini-2.5-flash',
      }),
    ).toEqual({ provider: 'gemini', model: 'gemini-3.1-pro-preview' });
  });

  it('allows DB model override only when enabled', () => {
    expect(
      resolveUniversalContentRoute({
        envProvider: 'gemini',
        envGeminiModel: 'gemini-2.5-pro',
        fallbackGeminiModel: 'gemini-2.5-flash',
        allowDbModel: false,
        dbContentModel: 'gpt-4.1-mini',
      }),
    ).toEqual({ provider: 'gemini', model: 'gemini-2.5-pro' });

    expect(
      resolveUniversalContentRoute({
        envProvider: 'gemini',
        envGeminiModel: 'gemini-2.5-pro',
        fallbackGeminiModel: 'gemini-2.5-flash',
        allowDbModel: true,
        dbContentModel: 'gpt-4.1-mini',
      }),
    ).toEqual({ provider: 'openai', model: 'gpt-4.1-mini' });
  });
});

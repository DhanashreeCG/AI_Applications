export type UniversalContentProvider = 'gemini' | 'openai';

export type UniversalContentRoute = {
  provider: UniversalContentProvider;
  model: string;
};

export function normalizeUniversalContentProvider(
  raw: string | null | undefined,
): UniversalContentProvider | null {
  const value = (raw || '').trim().toLowerCase();
  if (!value) return null;
  if (value.includes('openai') || value === 'gpt') return 'openai';
  if (value.includes('gemini') || value.includes('google')) return 'gemini';
  return null;
}

export function inferUniversalContentProviderFromModel(
  model: string,
): UniversalContentProvider {
  if (/^gpt-|^o[1-9]\b|openai/i.test(model.trim())) return 'openai';
  return 'gemini';
}

/**
 * Resolve provider + model for universal_template from env/config (and optional DB).
 * Explicit env provider/model win; DB override is opt-in only.
 */
export function resolveUniversalContentRoute(input: {
  envProvider?: string | null;
  configuredProvider?: string | null;
  envGeminiModel?: string | null;
  envOpenaiModel?: string | null;
  configuredGeminiModel?: string | null;
  configuredOpenaiModel?: string | null;
  fallbackGeminiModel: string;
  fallbackOpenaiModel?: string;
  allowDbModel?: boolean;
  dbContentModel?: string | null;
  dbContentProvider?: string | null;
}): UniversalContentRoute {
  let provider: UniversalContentProvider =
    normalizeUniversalContentProvider(input.envProvider) ||
    normalizeUniversalContentProvider(input.configuredProvider) ||
    'gemini';

  let model =
    provider === 'openai'
      ? (
          input.envOpenaiModel?.trim() ||
          input.configuredOpenaiModel?.trim() ||
          input.fallbackOpenaiModel ||
          'gpt-4.1-mini'
        )
      : (
          input.envGeminiModel?.trim() ||
          input.configuredGeminiModel?.trim() ||
          input.fallbackGeminiModel
        );

  if (input.allowDbModel) {
    const dbModel = input.dbContentModel?.trim() || '';
    if (dbModel) {
      provider =
        normalizeUniversalContentProvider(input.dbContentProvider) ||
        inferUniversalContentProviderFromModel(dbModel);
      model = dbModel;
    }
  }

  return { provider, model };
}

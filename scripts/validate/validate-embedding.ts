import { OpenAiEmbeddingProvider } from '../../src/modules/ai/providers/openai-embedding.provider';
import { parseArg, runValidation } from './shared/bootstrap';

void runValidation(async (app) => {
  const text =
    parseArg('text') ??
    'A playful orange cat sitting on a sunny windowsill with warm natural light';

  const startedAt = Date.now();
  const embeddingProvider = app.get(OpenAiEmbeddingProvider);
  const result = await embeddingProvider.generateEmbedding(text);

  return {
    text,
    provider: result.provider,
    model: result.model,
    dimensions: result.dimensions,
    sourceTextHash: result.sourceTextHash,
    latencyMs: Date.now() - startedAt,
    sample: result.embedding.slice(0, 5),
  };
});

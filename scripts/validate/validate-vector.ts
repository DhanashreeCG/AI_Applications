import { OpenAiEmbeddingProvider } from '../../src/modules/ai/providers/openai-embedding.provider';
import { VectorStorageService } from '../../src/modules/search/vector-storage.service';
import { parseArg, runValidation } from './shared/bootstrap';

void runValidation(async (app) => {
  const assetId = parseArg('asset-id');
  const text =
    parseArg('text') ??
    'A playful orange cat sitting on a sunny windowsill with warm natural light';
  const topK = parseInt(parseArg('top-k') ?? '5', 10);

  const embeddingProvider = app.get(OpenAiEmbeddingProvider);
  const vectorStorage = app.get(VectorStorageService);
  const embedding = await embeddingProvider.generateEmbedding(text);

  if (assetId) {
    const stored = await vectorStorage.storeFromEmbeddingResult(assetId, embedding);
    return { stored, searched: await vectorStorage.searchSimilar(embedding.embedding, topK) };
  }

  return {
    query: text,
    results: await vectorStorage.searchSimilar(embedding.embedding, topK),
  };
});

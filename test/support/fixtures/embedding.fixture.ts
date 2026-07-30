import { OPENAI_EMBEDDING_DIMENSIONS } from '../../../src/modules/ai/constants/embedding.constants';
import { hashSourceText } from '../../../src/modules/ai/utils/source-text-hash.util';
import { EmbeddingResult } from '../../../src/common/interfaces/embedding-provider.interface';

export function deterministicEmbedding(text: string): number[] {
  const normalized = text.trim().toLowerCase();
  const vector = new Array(OPENAI_EMBEDDING_DIMENSIONS).fill(0);

  for (let i = 0; i < normalized.length; i++) {
    const index = i % OPENAI_EMBEDDING_DIMENSIONS;
    vector[index] += normalized.charCodeAt(i) / 255;
  }

  const magnitude = Math.sqrt(
    vector.reduce((sum, value) => sum + value * value, 0),
  );

  if (magnitude === 0) {
    vector[0] = 1;
    return vector;
  }

  return vector.map((value) => value / magnitude);
}

export function buildTestEmbeddingResult(text: string): EmbeddingResult {
  const normalizedText = text.trim();

  return {
    embedding: deterministicEmbedding(normalizedText),
    dimensions: OPENAI_EMBEDDING_DIMENSIONS,
    provider: 'openai',
    model: 'text-embedding-3-small',
    sourceTextHash: hashSourceText(normalizedText),
  };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
  if (magnitude === 0) {
    return 0;
  }

  return dot / magnitude;
}

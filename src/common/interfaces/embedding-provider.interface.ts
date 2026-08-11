export interface EmbeddingResult {
  embedding: number[];
  dimensions: number;
  provider: string;
  model: string;
  sourceTextHash: string;
}

export interface EmbeddingProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly dimensions: number;

  generateEmbedding(text: string): Promise<EmbeddingResult>;
}

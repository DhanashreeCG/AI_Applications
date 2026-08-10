export interface StoreEmbeddingInput {
  assetId: string;
  embedding: number[];
  provider: string;
  model: string;
  sourceTextHash: string;
  dimensions?: number;
}

export interface StoredEmbeddingRecord {
  id: string;
  assetId: string;
  provider: string;
  model: string;
  dimensions: number;
  sourceTextHash: string;
  embeddingVersion: number;
}

export interface VectorSearchResult {
  assetId: string;
  embeddingId: string;
  distance: number;
  similarity: number;
}

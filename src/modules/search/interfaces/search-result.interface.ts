export interface SearchMetadataFilters {
  orientation?: string;
  colors?: string[];
  styles?: string[];
  objects?: string[];
  actions?: string[];
  ageGroups?: string[];
  grades?: string[];
  educationalUses?: string[];
  background?: string;
}

export interface SearchResultItem {
  assetId: string;
  similarity: number;
  distance: number;
  caption: string;
  orientation: string | null;
  colors: string[];
  styles: string[];
  objects: string[];
  actions: string[];
  ageGroups: string[];
  grades: string[];
  searchDescription: string;
  s3ObjectKey: string;
  mimeType: string;
}

export interface SearchEmbeddingUsage {
  inputTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  model?: string;
  fromCache?: boolean;
}

export interface SearchAssetsResponse {
  query: string;
  total: number;
  results: SearchResultItem[];
  fromCache?: boolean;
  /** Query-embedding usage for the search call (additive; optional for callers). */
  usage?: SearchEmbeddingUsage;
}

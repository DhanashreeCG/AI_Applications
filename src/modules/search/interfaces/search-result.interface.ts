export interface SearchMetadataFilters {
  orientation?: string;
  colors?: string[];
  styles?: string[];
  objects?: string[];
  actions?: string[];
  ageGroups?: string[];
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
  searchDescription: string;
  s3ObjectKey: string;
  mimeType: string;
}

export interface SearchAssetsResponse {
  query: string;
  total: number;
  results: SearchResultItem[];
}

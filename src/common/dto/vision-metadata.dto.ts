export interface VisionMetadataDto {
  caption: string;
  objects: string[];
  actions: string[];
  styles: string[];
  colors: string[];
  background: string;
  composition: string;
  orientation: 'portrait' | 'landscape' | 'square' | string;
  age_groups: string[];
  grades: Array<'toddlers' | 'kids' | 'teens' | 'adults'>;
  educational_uses: string[];
  search_keywords: string[];
  extra_tags?: Record<string, unknown>;
}

export interface VisionAnalysisResult {
  metadata: VisionMetadataDto;
  searchDescription: string;
  rawResponse: Record<string, unknown>;
  provider: string;
  model: string;
  modelVersion: string;
  promptVersion: string;
}

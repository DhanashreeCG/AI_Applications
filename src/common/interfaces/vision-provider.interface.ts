import { VisionAnalysisResult } from '../dto/vision-metadata.dto';

export interface VisionProviderInput {
  imageBuffer: Buffer;
  mimeType: string;
  /** When set, the vision prompt treats this file name as authoritative for letters/digits. */
  filename?: string;
  promptVersion?: string;
}

export interface VisionProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly modelVersion: string;

  analyzeImage(input: VisionProviderInput): Promise<VisionAnalysisResult>;
}

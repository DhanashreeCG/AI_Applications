export interface ImageValidationResult {
  isValid: boolean;
  format?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  size: number;
  orientation?: 'portrait' | 'landscape' | 'square';
  error?: string;
}

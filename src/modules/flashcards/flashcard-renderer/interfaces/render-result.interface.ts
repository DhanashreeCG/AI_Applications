export interface RenderedCardFile {
  cardIndex: number;
  cardId: string;
  fileName: string;
  absolutePath: string;
  relativePath: string;
}

export interface FlashcardRenderTiming {
  normalizeMs: number;
  htmlMs: number;
  browserMs: number;
  pdfMs: number;
  totalMs: number;
}

export interface FlashcardRenderResult {
  requestId: string;
  outputDir: string;
  cards: RenderedCardFile[];
  previewPath: string;
  previewRelativePath: string;
  pdfPath: string;
  pdfRelativePath: string;
  timing: FlashcardRenderTiming;
  warnings: string[];
}

export interface FlashcardRenderContext {
  apiBaseUrl: string;
  pageWidth: number;
  pageHeight: number;
  warnings: string[];
}

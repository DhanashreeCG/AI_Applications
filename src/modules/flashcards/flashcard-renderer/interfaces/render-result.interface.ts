import { FlashcardRenderStorageBackendType } from '../storage/flashcard-render-storage.interface';

export interface RenderedCardFile {
  cardIndex: number;
  cardId: string;
  fileName: string;
  path: string;
  uri: string;
}

export interface FlashcardRenderTiming {
  normalizeMs: number;
  htmlMs: number;
  browserMs: number;
  pdfMs: number;
  totalMs: number;
}

export interface FlashcardStoredAsset {
  path: string;
  uri: string;
}

export interface FlashcardRenderResult {
  storageBackend: FlashcardRenderStorageBackendType;
  requestId: string;
  outputLocation: string;
  cards: RenderedCardFile[];
  preview: FlashcardStoredAsset;
  pdf: FlashcardStoredAsset;
  timing: FlashcardRenderTiming;
  warnings: string[];
}

export interface FlashcardRenderContext {
  apiBaseUrl: string;
  pageWidth: number;
  pageHeight: number;
  warnings: string[];
  template?: {
    name: string;
    description: string | null;
    templateType: string;
    layoutType?: string;
  };
  request?: {
    learningObjective?: string;
  };
}

export type FlashcardRenderStorageBackendType = 'local' | 's3';

export interface StoredRenderFile {
  fileName: string;
  path: string;
  uri: string;
}

export interface SaveRenderFileInput {
  requestId: string;
  fileName: string;
  buffer: Buffer;
  contentType: string;
}

export interface FlashcardRenderStorageBackend {
  readonly type: FlashcardRenderStorageBackendType;

  resolveOutputLocation(requestId: string): string;

  saveFile(input: SaveRenderFileInput): Promise<StoredRenderFile>;

  readFile(path: string): Promise<Buffer>;
}

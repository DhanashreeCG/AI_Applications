export interface StorageUploadOptions {
  bucket?: string;
  key: string;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface StorageUploadResult {
  bucket: string;
  key: string;
  eTag?: string;
  location?: string;
}

export interface StorageProvider {
  uploadFile(buffer: Buffer, options: StorageUploadOptions): Promise<StorageUploadResult>;
  uploadStream(stream: NodeJS.ReadableStream, options: StorageUploadOptions): Promise<StorageUploadResult>;
  fileExists(key: string, bucket?: string): Promise<boolean>;
  getSignedUrl(key: string, expiresInSeconds?: number, bucket?: string): Promise<string>;
  downloadBuffer(key: string, bucket?: string): Promise<Buffer>;
  deleteFile(key: string, bucket?: string): Promise<void>;
}

import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { S3StorageService } from '../../src/modules/storage/s3-storage.service';
import { parseArg, runValidation } from './shared/bootstrap';

void runValidation(async (app) => {
  const filePath = parseArg('file');
  if (!filePath) {
    throw new Error('Missing required argument: --file <PATH_TO_IMAGE>');
  }

  const prefix = parseArg('prefix') ?? 'validation';
  const assetId = randomUUID();
  const filename = filePath.split(/[\\/]/).pop() ?? 'sample.png';
  const storage = app.get(S3StorageService);
  const bucket = storage.getDefaultBucket();
  const key = `${prefix}/${storage.generateCanonicalKey(assetId, filename)}`;
  const buffer = readFileSync(filePath);

  await storage.uploadFile(buffer, {
    key,
    bucket,
    contentType: 'image/png',
  });

  const exists = await storage.fileExists(key, bucket);
  const downloaded = await storage.downloadBuffer(key, bucket);

  return {
    bucket,
    key,
    uploadedBytes: buffer.length,
    exists,
    downloadedBytes: downloaded.length,
    sha256Match: buffer.equals(downloaded),
  };
});

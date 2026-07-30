import { readFileSync } from 'fs';
import { ImageProcessorService } from '../../src/modules/image/image-processor.service';
import { parseArg, runValidation } from './shared/bootstrap';

void runValidation(async (app) => {
  const filePath = parseArg('file');
  if (!filePath) {
    throw new Error('Missing required argument: --file <PATH_TO_IMAGE>');
  }

  const buffer = readFileSync(filePath);
  const imageProcessor = app.get(ImageProcessorService);
  const validation = await imageProcessor.validateImage(buffer);
  const hash = validation.isValid
    ? await imageProcessor.calculateSha256(buffer)
    : null;
  const optimized = validation.isValid
    ? await imageProcessor.generateAiOptimizedRepresentation(buffer)
    : null;

  return {
    filePath,
    validation,
    contentHash: hash,
    optimizedBytes: optimized?.buffer.length ?? null,
    optimizedMimeType: optimized?.mimeType ?? null,
  };
});

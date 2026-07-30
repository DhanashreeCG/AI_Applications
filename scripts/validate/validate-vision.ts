import { readFileSync } from 'fs';
import { GeminiVisionProvider } from '../../src/modules/ai/providers/gemini-vision.provider';
import { ImageProcessorService } from '../../src/modules/image/image-processor.service';
import { parseArg, runValidation } from './shared/bootstrap';

void runValidation(async (app) => {
  const filePath = parseArg('file');
  if (!filePath) {
    throw new Error('Missing required argument: --file <PATH_TO_IMAGE>');
  }

  const startedAt = Date.now();
  const buffer = readFileSync(filePath);
  const imageProcessor = app.get(ImageProcessorService);
  const vision = app.get(GeminiVisionProvider);
  const optimized = await imageProcessor.generateAiOptimizedRepresentation(buffer);
  const analysis = await vision.analyzeImage({
    imageBuffer: optimized.buffer,
    mimeType: optimized.mimeType,
  });

  return {
    filePath,
    provider: analysis.provider,
    model: analysis.model,
    promptVersion: analysis.promptVersion,
    latencyMs: Date.now() - startedAt,
    caption: analysis.metadata.caption,
    searchDescription: analysis.searchDescription,
    metadata: analysis.metadata,
  };
});

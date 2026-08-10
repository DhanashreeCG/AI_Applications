import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { ImageModule } from '../image/image.module';
import { GeminiVisionProvider } from './providers/gemini-vision.provider';
import { OpenAiEmbeddingProvider } from './providers/openai-embedding.provider';
import { VisionMetadataService } from './services/vision-metadata.service';
import { AiUsageService } from './services/ai-usage.service';

export const VISION_PROVIDER = Symbol('VISION_PROVIDER');
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

@Module({
  imports: [StorageModule, ImageModule],
  providers: [
    GeminiVisionProvider,
    OpenAiEmbeddingProvider,
    VisionMetadataService,
    AiUsageService,
    {
      provide: VISION_PROVIDER,
      useExisting: GeminiVisionProvider,
    },
    {
      provide: EMBEDDING_PROVIDER,
      useExisting: OpenAiEmbeddingProvider,
    },
  ],
  exports: [
    GeminiVisionProvider,
    OpenAiEmbeddingProvider,
    VisionMetadataService,
    AiUsageService,
    VISION_PROVIDER,
    EMBEDDING_PROVIDER,
  ],
})
export class AiModule {}

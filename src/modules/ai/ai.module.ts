import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { ImageModule } from '../image/image.module';
import { GeminiVisionProvider } from './providers/gemini-vision.provider';
import { VisionMetadataService } from './services/vision-metadata.service';

export const VISION_PROVIDER = Symbol('VISION_PROVIDER');

@Module({
  imports: [StorageModule, ImageModule],
  providers: [
    GeminiVisionProvider,
    VisionMetadataService,
    {
      provide: VISION_PROVIDER,
      useExisting: GeminiVisionProvider,
    },
  ],
  exports: [GeminiVisionProvider, VisionMetadataService, VISION_PROVIDER],
})
export class AiModule {}

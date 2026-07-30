import { Module } from '@nestjs/common';
import { GeminiVisionProvider } from './providers/gemini-vision.provider';

export const VISION_PROVIDER = Symbol('VISION_PROVIDER');

@Module({
  providers: [
    GeminiVisionProvider,
    {
      provide: VISION_PROVIDER,
      useExisting: GeminiVisionProvider,
    },
  ],
  exports: [GeminiVisionProvider, VISION_PROVIDER],
})
export class AiModule {}

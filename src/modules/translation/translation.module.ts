import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { GcpTranslationProvider } from './providers/gcp-translation.provider';
import { TranslationService } from './translation.service';

@Module({
  imports: [CacheModule],
  providers: [GcpTranslationProvider, TranslationService],
  exports: [TranslationService],
})
export class TranslationModule {}

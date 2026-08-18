import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { CacheModule } from '../cache/cache.module';
import { VectorStorageService } from './vector-storage.service';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { LetterQueryDetectorService } from './letter-query-detector.service';

@Module({
  imports: [AiModule, CacheModule],
  controllers: [SearchController],
  providers: [VectorStorageService, SearchService, LetterQueryDetectorService],
  exports: [VectorStorageService, SearchService],
})
export class SearchModule {}

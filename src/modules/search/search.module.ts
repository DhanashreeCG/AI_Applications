import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { VectorStorageService } from './vector-storage.service';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';

@Module({
  imports: [AiModule],
  controllers: [SearchController],
  providers: [VectorStorageService, SearchService],
  exports: [VectorStorageService, SearchService],
})
export class SearchModule {}

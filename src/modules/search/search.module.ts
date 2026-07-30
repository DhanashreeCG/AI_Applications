import { Module } from '@nestjs/common';
import { VectorStorageService } from './vector-storage.service';

@Module({
  providers: [VectorStorageService],
  exports: [VectorStorageService],
})
export class SearchModule {}

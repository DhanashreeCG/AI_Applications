import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { SearchModule } from '../search/search.module';
import { StorageModule } from '../storage/storage.module';
import { FlashcardsController } from './flashcards.controller';
import { AssetImageService } from './services/asset-image.service';
import { FlashcardContentService } from './services/flashcard-content.service';
import { FlashcardImageRetrievalService } from './services/flashcard-image-retrieval.service';
import { FlashcardOrchestratorService } from './services/flashcard-orchestrator.service';
import { FlashcardSeedService } from './services/flashcard-seed.service';
import { TemplateRepository } from './services/template.repository';
import { TemplateSelectionService } from './services/template-selection.service';

@Module({
  imports: [AiModule, SearchModule, StorageModule],
  controllers: [FlashcardsController],
  providers: [
    AssetImageService,
    TemplateRepository,
    TemplateSelectionService,
    FlashcardContentService,
    FlashcardImageRetrievalService,
    FlashcardOrchestratorService,
    FlashcardSeedService,
  ],
  exports: [FlashcardOrchestratorService, TemplateSelectionService],
})
export class FlashcardsModule {}

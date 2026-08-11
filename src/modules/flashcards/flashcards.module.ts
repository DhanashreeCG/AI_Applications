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
import { FlashcardTemplateService } from './services/flashcard-template.service';
import { TemplateCatalogCacheService } from './services/template-catalog-cache.service';
import { TemplateRepository } from './services/template.repository';
import { TemplateSelectionAiService } from './services/template-selection-ai.service';
import { TemplateSelectionService } from './services/template-selection.service';
import { FlashcardRendererService } from './flashcard-renderer/renderer/flashcard-renderer.service';
import { BrowserPoolService } from './flashcard-renderer/browser/browser-pool.service';
import { FlashcardPdfService } from './flashcard-renderer/pdf/flashcard-pdf.service';
import { FlashcardStorageService } from './flashcard-renderer/storage/flashcard-storage.service';

@Module({
  imports: [AiModule, SearchModule, StorageModule],
  controllers: [FlashcardsController],
  providers: [
    AssetImageService,
    TemplateRepository,
    TemplateCatalogCacheService,
    TemplateSelectionAiService,
    TemplateSelectionService,
    FlashcardTemplateService,
    FlashcardContentService,
    FlashcardImageRetrievalService,
    FlashcardOrchestratorService,
    FlashcardSeedService,
    BrowserPoolService,
    FlashcardStorageService,
    FlashcardPdfService,
    FlashcardRendererService,
  ],
  exports: [
    FlashcardOrchestratorService,
    TemplateSelectionService,
    FlashcardRendererService,
  ],
})
export class FlashcardsModule {}

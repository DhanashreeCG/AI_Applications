import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { FlashcardsModule } from '../flashcards/flashcards.module';
import { ImageModule } from '../image/image.module';
import { SearchModule } from '../search/search.module';
import { StorageModule } from '../storage/storage.module';
import { GenericWorksheetRenderer } from './renderers/generic-worksheet.renderer';
import { WorksheetRendererRegistry } from './renderers/worksheet-renderer.registry';
import { WorksheetAssetService } from './services/worksheet-asset.service';
import { WorksheetContentService } from './services/worksheet-content.service';
import { WorksheetEditService } from './services/worksheet-edit.service';
import { WorksheetGenerationService } from './services/worksheet-generation.service';
import { WorksheetRenderService } from './services/worksheet-render.service';
import { WorksheetTemplateSelectionService } from './services/worksheet-template-selection.service';
import { WorksheetTemplateService } from './services/worksheet-template.service';
import { WorksheetValidationService } from './services/worksheet-validation.service';
import { WorksheetsController } from './worksheets.controller';

@Module({
  imports: [AiModule, SearchModule, StorageModule, ImageModule, FlashcardsModule],
  controllers: [WorksheetsController],
  providers: [
    WorksheetTemplateService,
    WorksheetTemplateSelectionService,
    WorksheetValidationService,
    WorksheetContentService,
    WorksheetAssetService,
    WorksheetGenerationService,
    WorksheetEditService,
    GenericWorksheetRenderer,
    WorksheetRendererRegistry,
    WorksheetRenderService,
  ],
})
export class WorksheetsModule {}

import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { FlashcardsModule } from '../flashcards/flashcards.module';
import { ImageModule } from '../image/image.module';
import { SearchModule } from '../search/search.module';
import { StorageModule } from '../storage/storage.module';
import { GenericWorksheetRenderer } from './renderers/generic-worksheet.renderer';
import { CircleTheThingsRenderer } from './renderers/circle-the-things.renderer';
import { WorksheetRendererRegistry } from './renderers/worksheet-renderer.registry';
import { WorksheetAssetService } from './services/worksheet-asset.service';
import { WorksheetFieldMetadataService } from './services/worksheet-field-metadata.service';
import { WorksheetContentService } from './services/worksheet-content.service';
import { WorksheetEditService } from './services/worksheet-edit.service';
import { WorksheetGenerationService } from './services/worksheet-generation.service';
import { WorksheetRenderNotifyService } from './services/worksheet-render-notify.service';
import { WorksheetRenderService } from './services/worksheet-render.service';
import { WorksheetTemplateSelectionService } from './services/worksheet-template-selection.service';
import { WorksheetTemplateSelectionAiService } from './services/worksheet-template-selection-ai.service';
import { WorksheetTemplateService } from './services/worksheet-template.service';
import { WorksheetValidationService } from './services/worksheet-validation.service';
import { WorksheetsController } from './worksheets.controller';

@Module({
  imports: [AiModule, SearchModule, StorageModule, ImageModule, FlashcardsModule],
  controllers: [WorksheetsController],
  providers: [
    WorksheetTemplateService,
    WorksheetTemplateSelectionService,
    WorksheetTemplateSelectionAiService,
    WorksheetValidationService,
    WorksheetContentService,
    WorksheetAssetService,
    WorksheetGenerationService,
    WorksheetEditService,
    GenericWorksheetRenderer,
    CircleTheThingsRenderer,
    WorksheetRendererRegistry,
    WorksheetRenderService,
    WorksheetRenderNotifyService,
    WorksheetFieldMetadataService,
  ],
})
export class WorksheetsModule {}

import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { ApiConsumes, ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { FLASHCARD_USER_UPLOAD_MAX_BYTES } from './constants/flashcard.constants';
import { DownloadFlashcardDto, EditFlashcardDto, SearchFlashcardImagesQueryDto } from './dto/edit-flashcard.dto';
import { GenerateFlashcardsDto } from './dto/generate-flashcards.dto';
import { ListFlashcardTemplatesResponseDto } from './dto/flashcard-template-summary.dto';
import { RenderFlashcardsDto } from './dto/render-flashcards.dto';
import {
  SaveFlashcardEditsDto,
  SaveGeneratedFlashcardsDto,
} from './dto/save-flashcards.dto';
import { UploadFlashcardTemplatesDto } from './dto/upload-flashcard-template.dto';
import { FlashcardException } from './errors/flashcard.exception';
import { GenerateFlashcardsResponse } from './interfaces/flashcard.interfaces';
import { FlashcardRendererService } from './flashcard-renderer/renderer/flashcard-renderer.service';
import { AssetImageService } from './services/asset-image.service';
import { FlashcardDownloadService } from './services/flashcard-download.service';
import { FlashcardEditService } from './services/flashcard-edit.service';
import { FlashcardOrchestratorService } from './services/flashcard-orchestrator.service';
import { FlashcardPersistenceService } from './services/flashcard-persistence.service';
import { FlashcardTemplateService } from './services/flashcard-template.service';

@ApiTags('flashcards')
@Controller('flashcards')
export class FlashcardsController {
  constructor(
    private readonly orchestrator: FlashcardOrchestratorService,
    private readonly assetImageService: AssetImageService,
    private readonly templateService: FlashcardTemplateService,
    private readonly rendererService: FlashcardRendererService,
    private readonly persistence: FlashcardPersistenceService,
    private readonly editService: FlashcardEditService,
    private readonly downloadService: FlashcardDownloadService,
  ) {}

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Generate rendering-ready flashcards from a user query + age group',
  })
  async generate(
    @Body() dto: GenerateFlashcardsDto,
    @Headers('x-trace-id') traceId?: string,
    @Headers('x-correlation-id') correlationId?: string,
    @Headers('x-country-code') headerCountryCode?: string,
  ) {
    return this.orchestrator.generate(
      {
        ...dto,
        countryCode: dto.countryCode || headerCountryCode,
      },
      {
        correlationId: correlationId || traceId,
      },
    );
  }

  @Post('save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Persist a generated flashcard set in the database',
  })
  async saveGenerated(@Body() dto: SaveGeneratedFlashcardsDto) {
    return this.persistence.saveGenerated(dto);
  }

  @Post('download')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Playwright-capture unsaved flashcards as pdf, png, or webp (does not persist to the database)',
  })
  async downloadUnsaved(
    @Body() dto: SaveGeneratedFlashcardsDto & DownloadFlashcardDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const result = await this.downloadService.downloadFromPayload(
      dto as unknown as GenerateFlashcardsResponse,
      dto.format,
      dto.cardIndex,
    );
    response.setHeader('Content-Type', result.contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.fileName}"`,
    );
    return new StreamableFile(result.buffer);
  }

  @Get('images/search')
  @ApiOperation({
    summary: 'Semantic asset search without a saved flashcard set',
  })
  async searchLibraryImages(@Query() query: SearchFlashcardImagesQueryDto) {
    return this.editService.searchLibrary({
      query: query.query,
      limit: query.limit != null ? Number(query.limit) : undefined,
    });
  }

  @Post('render')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Render flashcards to WebP images and PDF from a GenerateFlashcardsResponse payload (requires FLASHCARD_RENDERER_ENABLED=true)',
  })
  async render(@Body() dto: RenderFlashcardsDto) {
    if (!this.rendererService.isEnabled()) {
      throw new ServiceUnavailableException(
        'Flashcard renderer is disabled (FLASHCARD_RENDERER_ENABLED=false)',
      );
    }
    return this.rendererService.render(dto);
  }

  @Get('templates')
  @ApiOperation({
    summary: 'List all flashcard templates (id, name, templateType, layoutType)',
  })
  @ApiOkResponse({ type: ListFlashcardTemplatesResponseDto })
  async listTemplates() {
    return this.templateService.listAll();
  }

  @Post('templates')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Upload one or more flashcard templates (ids auto-generated; layout-only)',
  })
  async uploadTemplates(@Body() dto: UploadFlashcardTemplatesDto) {
    return this.templateService.upload(dto);
  }

  @Get('assets/:assetId/image')
  @Header('Cache-Control', 'private, max-age=3600')
  @ApiOperation({
    summary:
      'Stream an asset image from the same origin (avoids S3 CORS in canvas renderers)',
  })
  async getAssetImage(
    @Param('assetId') assetId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { buffer, mimeType } =
      await this.assetImageService.loadImage(assetId);
    response.setHeader('Content-Type', mimeType);
    return new StreamableFile(buffer);
  }

  @Post(':flashcardId/edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Regenerate one editable flashcard component using the content LLM',
  })
  async edit(
    @Param('flashcardId') flashcardId: string,
    @Body() dto: EditFlashcardDto,
    @Headers('x-trace-id') traceId?: string,
    @Headers('x-correlation-id') correlationId?: string,
    @Headers('x-country-code') headerCountryCode?: string,
  ) {
    return this.editService.edit(
      flashcardId,
      {
        ...dto,
        countryCode: dto.countryCode || headerCountryCode,
      },
      {
        correlationId: correlationId || traceId,
      },
    );
  }

  @Post(':flashcardId/download')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Download a saved flashcard set as pdf, png, or webp via Playwright (same UI card markup).',
  })
  async download(
    @Param('flashcardId') flashcardId: string,
    @Body() dto: DownloadFlashcardDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const result = await this.downloadService.download(
      flashcardId,
      dto.format,
      dto.cardIndex,
    );
    response.setHeader('Content-Type', result.contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.fileName}"`,
    );
    return new StreamableFile(result.buffer);
  }

  @Get(':flashcardId/images/search')
  @ApiOperation({
    summary: 'Semantic asset search for replacing a flashcard image slot',
  })
  async searchImages(
    @Param('flashcardId') flashcardId: string,
    @Query() query: SearchFlashcardImagesQueryDto,
  ) {
    return this.editService.searchImages(flashcardId, {
      query: query.query,
      cardId: query.cardId,
      componentId: query.componentId,
      limit: query.limit != null ? Number(query.limit) : undefined,
    });
  }

  @Post(':flashcardId/images/upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: FLASHCARD_USER_UPLOAD_MAX_BYTES },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Upload a user image to S3 for a flashcard image slot (persisted on save). Stores the S3 key, not a library asset id.',
  })
  async uploadImage(
    @Param('flashcardId') flashcardId: string,
    @UploadedFile()
    file: { buffer: Buffer; mimetype?: string; originalname?: string; size?: number },
    @Body() body: { cardId?: string; componentId?: string },
  ) {
    if (!file?.buffer?.length) {
      throw new FlashcardException(
        'INVALID_REQUEST',
        'Choose an image file to upload',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.editService.uploadImage(
      flashcardId,
      body.cardId || '',
      body.componentId || '',
      file,
    );
  }

  @Get(':flashcardId/uploads/:uploadId/image')
  @Header('Cache-Control', 'private, max-age=3600')
  @ApiOperation({ summary: 'Stream a user-uploaded flashcard image from S3' })
  async getUploadedImage(
    @Param('flashcardId') flashcardId: string,
    @Param('uploadId') uploadId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { buffer, mimeType } = await this.editService.loadUserUpload(
      flashcardId,
      uploadId,
    );
    response.setHeader('Content-Type', mimeType);
    return new StreamableFile(buffer);
  }

  @Post(':flashcardId/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Persist inline text edits and image replacements (library asset or user-uploaded S3 key) in one write',
  })
  async saveEdits(
    @Param('flashcardId') flashcardId: string,
    @Body() dto: SaveFlashcardEditsDto,
  ) {
    return this.editService.saveEdits(flashcardId, dto);
  }

  @Get(':flashcardId')
  @ApiOperation({ summary: 'Load one saved flashcard set' })
  async getById(@Param('flashcardId') flashcardId: string) {
    return this.persistence.getById(flashcardId);
  }
}

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
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GenerateFlashcardsDto } from './dto/generate-flashcards.dto';
import { UploadFlashcardTemplatesDto } from './dto/upload-flashcard-template.dto';
import { AssetImageService } from './services/asset-image.service';
import { FlashcardOrchestratorService } from './services/flashcard-orchestrator.service';
import { FlashcardTemplateService } from './services/flashcard-template.service';

@ApiTags('flashcards')
@Controller('flashcards')
export class FlashcardsController {
  constructor(
    private readonly orchestrator: FlashcardOrchestratorService,
    private readonly assetImageService: AssetImageService,
    private readonly templateService: FlashcardTemplateService,
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
  ) {
    return this.orchestrator.generate(dto, {
      correlationId: correlationId || traceId,
    });
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
}

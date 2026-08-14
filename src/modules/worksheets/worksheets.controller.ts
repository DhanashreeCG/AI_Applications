import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AssetImageService } from '../flashcards/services/asset-image.service';
import {
  CreateWorksheetTemplateDto,
  CreateWorksheetTemplateResponseDto,
} from './dto/create-worksheet-template.dto';
import { EditWorksheetDto } from './dto/edit-worksheet.dto';
import {
  GenerateWorksheetDto,
  GenerateWorksheetResponseDto,
} from './dto/generate-worksheet.dto';
import { RenderWorksheetDto } from './dto/render-worksheet.dto';
import { WORKSHEET_TEMPLATE_IMAGE_MAX_BYTES } from './constants/worksheet.constants';
import { WorksheetEditService } from './services/worksheet-edit.service';
import { WorksheetGenerationService } from './services/worksheet-generation.service';
import { WorksheetRenderService } from './services/worksheet-render.service';
import {
  WorksheetTemplateService,
  UploadedTemplateImage,
} from './services/worksheet-template.service';

@ApiTags('worksheets')
@Controller('worksheets')
export class WorksheetsController {
  constructor(
    private readonly generationService: WorksheetGenerationService,
    private readonly editService: WorksheetEditService,
    private readonly renderService: WorksheetRenderService,
    private readonly templateService: WorksheetTemplateService,
    private readonly assetImageService: AssetImageService,
  ) {}

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Generate a rendering-ready worksheet structure from an educational request',
  })
  @ApiOkResponse({ type: GenerateWorksheetResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid request or generated structure' })
  @ApiNotFoundResponse({ description: 'No matching worksheet template' })
  async generate(@Body() dto: GenerateWorksheetDto) {
    return this.generationService.generate(dto);
  }

  @Post('templates')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'background', maxCount: 1 },
        { name: 'sample', maxCount: 1 },
        { name: 'example', maxCount: 1 },
      ],
      { limits: { fileSize: WORKSHEET_TEMPLATE_IMAGE_MAX_BYTES } },
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Create a worksheet template and upload background + example images to S3',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: [
        'name',
        'slug',
        'category',
        'templateHtml',
        'structureDefinition',
        'background',
        'sample',
      ],
      properties: {
        name: { type: 'string', example: 'Counting Objects' },
        slug: { type: 'string', example: 'counting_objects_v1' },
        category: { type: 'string', example: 'numeracy' },
        description: { type: 'string' },
        status: { type: 'string', enum: ['DRAFT', 'ACTIVE', 'INACTIVE'] },
        version: { type: 'integer', example: 1 },
        templateHtml: { type: 'string' },
        structureDefinition: { type: 'string', description: 'JSON object or JSON string' },
        meta: { type: 'string' },
        rendererType: { type: 'string', example: 'generic' },
        rendererConfig: { type: 'string' },
        aiConfig: { type: 'string' },
        fieldPrompts: { type: 'string' },
        aiSystemPrompt: { type: 'string' },
        background: { type: 'string', format: 'binary' },
        sample: {
          type: 'string',
          format: 'binary',
          description: 'Example/preview image (alias field name: example)',
        },
        example: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiCreatedResponse({ type: CreateWorksheetTemplateResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid template payload or image' })
  @ApiConflictResponse({ description: 'Slug already exists' })
  async createTemplate(
    @Body() dto: CreateWorksheetTemplateDto,
    @UploadedFiles()
    files: {
      background?: UploadedTemplateImage[];
      sample?: UploadedTemplateImage[];
      example?: UploadedTemplateImage[];
    },
  ) {
    const background = files?.background?.[0];
    const sample = files?.sample?.[0] ?? files?.example?.[0];
    return this.templateService.create(dto, { background, sample });
  }

  @Post(':worksheetId/edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Regenerate one editable worksheet field using Gemini',
  })
  @ApiOkResponse({ type: GenerateWorksheetResponseDto })
  @ApiBadRequestResponse({
    description: 'Field is invalid, not editable, or replacement failed validation',
  })
  @ApiNotFoundResponse({ description: 'Worksheet not found' })
  async edit(
    @Param('worksheetId') worksheetId: string,
    @Body() dto: EditWorksheetDto,
  ) {
    return this.editService.edit(worksheetId, dto);
  }

  @Post(':worksheetId/render')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Render a generated worksheet to html, webp, or pdf',
  })
  @ApiBadRequestResponse({ description: 'Unsupported format or renderer type' })
  @ApiNotFoundResponse({ description: 'Worksheet not found' })
  async render(
    @Param('worksheetId') worksheetId: string,
    @Body() dto: RenderWorksheetDto,
  ) {
    return this.renderService.render(worksheetId, dto.format);
  }

  @Get('assets/:assetId/image')
  @Header('Cache-Control', 'private, max-age=3600')
  @ApiOperation({
    summary:
      'Stream an asset image from the same origin for worksheet rendering',
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

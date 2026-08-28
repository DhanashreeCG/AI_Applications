import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
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
import { ReplaceWorksheetImageDto } from './dto/replace-worksheet-image.dto';
import { SaveWorksheetDto } from './dto/save-worksheet.dto';
import { RegenerateWorksheetDto } from './dto/regenerate-worksheet.dto';
import {
  SearchWorksheetImagesQueryDto,
  UpdateWorksheetFieldDto,
} from './dto/update-worksheet-field.dto';
import { WORKSHEET_TEMPLATE_IMAGE_MAX_BYTES } from './constants/worksheet.constants';
import { WorksheetException } from './errors/worksheet.exception';
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
    private readonly configService: ConfigService,
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
  async generate(
    @Body() dto: GenerateWorksheetDto,
    @Headers('x-trace-id') traceId?: string,
    @Headers('x-correlation-id') correlationId?: string,
    @Headers('x-country-code') headerCountryCode?: string,
  ) {
    return this.generationService.generate(
      { ...dto, countryCode: dto.countryCode || headerCountryCode },
      {
        correlationId: correlationId || traceId,
      },
    );
  }

  @Post('generate-set')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Generate a set of worksheets for matching templates (topic + age group UI)',
  })
  async generateSet(
    @Body() dto: GenerateWorksheetDto,
    @Headers('x-trace-id') traceId?: string,
    @Headers('x-correlation-id') correlationId?: string,
    @Headers('x-country-code') headerCountryCode?: string,
  ) {
    return this.generationService.generateSet(
      { ...dto, countryCode: dto.countryCode || headerCountryCode },
      {
        correlationId: correlationId || traceId,
      },
    );
  }

  @Get('settings')
  @ApiOperation({
    summary: 'UI settings including default generate count',
  })
  settings() {
    return this.generationService.uiSettings();
  }

  @Get()
  @ApiOperation({ summary: 'List generated worksheets for the results grid' })
  async list(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.generationService.list({
      skip: skip != null ? Number(skip) : 0,
      take: take != null ? Number(take) : 10,
    });
  }

  @Get('templates')
  @ApiOperation({ summary: 'List active worksheet templates for the catalog grid' })
  async listTemplates() {
    return this.templateService.listCatalog();
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
    @Headers('x-trace-id') traceId?: string,
    @Headers('x-correlation-id') correlationId?: string,
    @Headers('x-country-code') headerCountryCode?: string,
  ) {
    return this.editService.edit(
      worksheetId,
      { ...dto, countryCode: dto.countryCode || headerCountryCode },
      {
        correlationId: correlationId || traceId,
      },
    );
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
    @Headers('x-trace-id') traceId?: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const { buffer: _buffer, ...result } = await this.renderService.render(
      worksheetId,
      dto.format,
      {
        correlationId: correlationId || traceId,
        mode: dto.mode,
      },
    );
    return result;
  }

  @Post(':worksheetId/download')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Render a worksheet and download the png, webp or pdf as an attachment',
  })
  async download(
    @Param('worksheetId') worksheetId: string,
    @Body() dto: RenderWorksheetDto,
    @Res({ passthrough: true }) response: Response,
    @Headers('x-trace-id') traceId?: string,
    @Headers('x-correlation-id') correlationId?: string,
  ): Promise<StreamableFile> {
    const result = await this.renderService.render(worksheetId, dto.format, {
      correlationId: correlationId || traceId,
      mode: dto.mode ?? 'export',
    });
    if (!result.buffer || (dto.format !== 'webp' && dto.format !== 'png' && dto.format !== 'pdf')) {
      throw new WorksheetException(
        'UNSUPPORTED_FORMAT',
        'Download is only available for png, webp and pdf',
        HttpStatus.BAD_REQUEST,
      );
    }
    const fileName = `worksheet-${worksheetId}.${result.format}`;
    const contentType =
      result.format === 'pdf'
        ? 'application/pdf'
        : result.format === 'png'
          ? 'image/png'
          : 'image/webp';
    response.setHeader('Content-Type', contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`,
    );
    return new StreamableFile(result.buffer);
  }

  @Post('render-and-notify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Render worksheet to PNG, upload to S3, and return structured resource list for postMessage',
  })
  async renderAndNotify(
    @Body() body: any, // The full in-memory structure + templateId + auth etc
    @Headers('x-trace-id') traceId?: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const parentOrigin = this.configService.get<string>('worksheets.parentOrigin') ?? '*';
    const templateId = body.templateId;
    const structure = body.structure;
    const request = body.request;

    if (!templateId || !structure) {
      throw new HttpException('Missing templateId or structure', HttpStatus.BAD_REQUEST);
    }

    const resources: { url: string; signedUrl: string; s3Key: string; folder: string; fileName: string; mediaId?: string }[] = [];
    const uploadApiUrl = this.configService.get<string>('worksheets.upload.apiUrl') || 'https://gyan-dev-api.creativegalileo.com/api/gyan/V1/media/upload-media';
    const entityName = this.configService.get<string>('worksheets.upload.entityName') || 'worksheets';
    const entityType = this.configService.get<string>('worksheets.upload.entityType') || 'worksheets';
    const folderName = this.configService.get<string>('worksheets.upload.folderName') || 'worksheets';

    try {
      const result = await this.renderService.renderFromPayload(
        { templateId, structure, request },
        'png',
        { correlationId: correlationId || traceId, mode: 'export' },
      );

      if (!result.buffer) {
        throw new Error('Failed to generate PNG buffer');
      }

      // Save to S3 via external API (same logic as flashcards)
      const form = new FormData();
      const blob = new Blob([result.buffer as any], { type: 'image/png' });
      const filename = `worksheet-${Date.now()}.png`;
      form.append('files', blob, filename);
      form.append('entityName', entityName);
      form.append('entityType', entityType);
      form.append('folderName', folderName);

      const headers: Record<string, string> = {};
      if (body.auth) headers['Authorization'] = `Bearer ${body.auth}`;
      const uploadRes = await fetch(uploadApiUrl, { method: 'POST', headers, body: form as any });
      
      if (!uploadRes.ok) {
        const errorText = await uploadRes.text();
        throw new HttpException(`Failed to upload media: ${errorText}`, HttpStatus.BAD_GATEWAY);
      }

      const uploadResult = await uploadRes.json();
      if (!uploadResult.success || !uploadResult.data || !uploadResult.data[0]) {
        throw new HttpException(`Invalid response from upload media API: ${JSON.stringify(uploadResult)}`, HttpStatus.BAD_GATEWAY);
      }

      const mediaData = uploadResult.data[0];

      resources.push({
        url: mediaData.Location,
        signedUrl: mediaData.Location,
        s3Key: mediaData.key || mediaData.Key,
        folder: folderName,
        fileName: filename,
        mediaId: mediaData.mediaId,
      });

      return { success: true, resources };
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : 'Render and notify failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':worksheetId/preview')
  @ApiOperation({
    summary:
      'Return resolved worksheet HTML plus editor metadata (same HTML as render)',
  })
  async preview(
    @Param('worksheetId') worksheetId: string,
    @Query('mode') mode: 'editor' | 'export' = 'editor',
    @Headers('x-trace-id') traceId?: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.renderService.preview(worksheetId, mode, {
      correlationId: correlationId || traceId,
    });
  }

  @Get(':worksheetId/images/search')
  @ApiOperation({
    summary: 'Semantic asset search for replacing a worksheet image slot',
  })
  async searchImages(
    @Param('worksheetId') worksheetId: string,
    @Query() query: SearchWorksheetImagesQueryDto,
    @Headers('x-country-code') headerCountryCode?: string,
  ) {
    return this.editService.searchImages(worksheetId, {
      query: query.query,
      path: query.path,
      limit: query.limit != null ? Number(query.limit) : undefined,
      countryCode: query.countryCode || headerCountryCode,
    });
  }

  @Post(':worksheetId/images/upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: WORKSHEET_TEMPLATE_IMAGE_MAX_BYTES },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a user image to S3 for a worksheet image slot (persisted on save)',
  })
  async uploadImage(
    @Param('worksheetId') worksheetId: string,
    @UploadedFile() file: { buffer: Buffer; mimetype?: string; originalname?: string; size?: number },
    @Body() body: { path?: string },
  ) {
    if (!file?.buffer?.length) {
      throw new WorksheetException(
        'INVALID_REQUEST',
        'Choose an image file to upload',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.editService.uploadImage(worksheetId, body.path || '', file);
  }

  @Get(':worksheetId/uploads/:uploadId/image')
  @Header('Cache-Control', 'private, max-age=3600')
  @ApiOperation({ summary: 'Stream a user-uploaded worksheet image from S3' })
  async getUploadedImage(
    @Param('worksheetId') worksheetId: string,
    @Param('uploadId') uploadId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { buffer, mimeType } = await this.editService.loadUserUpload(
      worksheetId,
      uploadId,
    );
    response.setHeader('Content-Type', mimeType);
    return new StreamableFile(buffer);
  }

  @Post(':worksheetId/save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Persist inline text edits and image replacements (library or user upload) in one write',
  })
  async saveEdits(
    @Param('worksheetId') worksheetId: string,
    @Body() dto: SaveWorksheetDto,
  ) {
    return this.editService.saveEdits(worksheetId, dto);
  }

  @Post(':worksheetId/regenerate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Regenerate this worksheet in place from new requirements, keeping the same template',
  })
  async regenerate(
    @Param('worksheetId') worksheetId: string,
    @Body() dto: RegenerateWorksheetDto,
    @Headers('x-country-code') headerCountryCode?: string,
  ) {
    return this.editService.regenerate(worksheetId, {
      ...dto,
      countryCode: dto.countryCode || headerCountryCode,
    });
  }

  @Post(':worksheetId/images')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Replace an image slot assetId after the user picks a search result',
  })
  async replaceImage(
    @Param('worksheetId') worksheetId: string,
    @Body() dto: ReplaceWorksheetImageDto,
  ) {
    return this.editService.replaceImage(worksheetId, dto.path, dto.assetId);
  }

  @Post(':worksheetId/fields')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set one editable field as text (no Gemini). HTML values are rejected.',
  })
  async updateField(
    @Param('worksheetId') worksheetId: string,
    @Body() dto: UpdateWorksheetFieldDto,
  ) {
    return this.editService.updateField(worksheetId, dto.path, dto.value);
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

  @Get(':worksheetId')
  @ApiOperation({ summary: 'Load one generated worksheet' })
  async getById(@Param('worksheetId') worksheetId: string) {
    return this.generationService.getById(worksheetId);
  }
}

import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ImageProcessorService } from '../../image/image-processor.service';
import { S3StorageService } from '../../storage/s3-storage.service';
import { CreateWorksheetTemplateDto } from '../dto/create-worksheet-template.dto';
import { WorksheetException } from '../errors/worksheet.exception';
import {
  GENERIC_RENDERER_TYPE,
  WORKSHEET_TEMPLATE_IMAGE_MAX_BYTES,
  WORKSHEET_TEMPLATE_IMAGE_MIME_TYPES,
} from '../constants/worksheet.constants';
import {
  WorksheetAiConfig,
  WorksheetFieldPrompts,
  WorksheetRendererConfig,
  WorksheetTemplateMeta,
} from '../types/worksheet.types';
import { parseJsonField, parseJsonObject } from '../utils/structure.util';

export type WorksheetTemplateRecord = Prisma.WorksheetTemplateGetPayload<object>;

export interface UploadedTemplateImage {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface CreateWorksheetTemplateResult {
  id: string;
  name: string;
  slug: string;
  category: string;
  status: string;
  version: number;
  rendererType: string;
  backgroundAssetId: string;
  sampleAssetId: string;
  backgroundUrl?: string;
  sampleUrl?: string;
  aiEditConfigJs?: string | null;
  aiEditPopupHtml?: string | null;
  aiEditPanelJs?: string | null;
  editorJs?: string | null;
  fieldEditorJs?: string | null;
  rendererJs?: string | null;
}

const TEMPLATE_STATUSES = new Set(['DRAFT', 'ACTIVE', 'INACTIVE']);

@Injectable()
export class WorksheetTemplateService {
  private readonly logger = new Logger(WorksheetTemplateService.name);
  private readonly signedUrlTtlSeconds: number;
  private readonly assetImagePath: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3StorageService: S3StorageService,
    private readonly imageProcessor: ImageProcessorService,
    private readonly configService: ConfigService,
  ) {
    this.signedUrlTtlSeconds =
      this.configService.get<number>('worksheets.signedUrlTtlSeconds') ?? 3600;
    this.assetImagePath = (
      this.configService.get<string>('worksheets.assetImagePath') ??
      '/worksheets/assets'
    ).replace(/\/$/, '');
  }

  public async create(
    dto: CreateWorksheetTemplateDto,
    files: {
      background?: UploadedTemplateImage;
      sample?: UploadedTemplateImage;
    },
  ): Promise<CreateWorksheetTemplateResult> {
    const name = this.requireString(dto.name, 'name');
    const slug = this.normalizeSlug(this.requireString(dto.slug, 'slug'));
    const category = this.requireString(dto.category, 'category');
    const templateHtml = this.requireString(dto.templateHtml, 'templateHtml');
    const structureDefinition = parseJsonField(
      dto.structureDefinition,
      'structureDefinition',
      true,
    );
    if (!structureDefinition) {
      throw new WorksheetException(
        'INVALID_REQUEST',
        'structureDefinition is required',
        HttpStatus.BAD_REQUEST,
        { field: 'structureDefinition' },
      );
    }

    const background = files.background;
    const sample = files.sample;
    if (!background?.buffer?.length) {
      throw new WorksheetException(
        'INVALID_REQUEST',
        'background image file is required',
        HttpStatus.BAD_REQUEST,
        { field: 'background' },
      );
    }
    if (!sample?.buffer?.length) {
      throw new WorksheetException(
        'INVALID_REQUEST',
        'sample (example) image file is required',
        HttpStatus.BAD_REQUEST,
        { field: 'sample' },
      );
    }

    const status = this.parseStatus(dto.status);
    const version = this.parseVersion(dto.version);
    const rendererType =
      this.optionalString(dto.rendererType) || GENERIC_RENDERER_TYPE;
    const liftedAiConfig = this.liftAiConfigFromStructure(
      structureDefinition,
      dto.aiConfig,
    );

    const [backgroundAsset, sampleAsset] = await Promise.all([
      this.uploadTemplateImage(background, 'background'),
      this.uploadTemplateImage(sample, 'sample'),
    ]);

    try {
      const template = await this.prisma.worksheetTemplate.create({
        data: {
          name,
          slug,
          category,
          description: this.optionalString(dto.description) ?? null,
          status,
          version,
          templateHtml,
          structureDefinition: structureDefinition as Prisma.InputJsonValue,
          rendererType,
          backgroundAssetId: backgroundAsset.id,
          sampleAssetId: sampleAsset.id,
          aiSystemPrompt: this.optionalString(dto.aiSystemPrompt) ?? null,
          aiEditConfigJs: this.optionalString(dto.aiEditConfigJs) ?? null,
          aiEditPopupHtml: this.optionalString(dto.aiEditPopupHtml) ?? null,
          aiEditPanelJs: this.optionalString(dto.aiEditPanelJs) ?? null,
          editorJs: this.optionalString(dto.editorJs) ?? null,
          fieldEditorJs: this.optionalString(dto.fieldEditorJs) ?? null,
          rendererJs: this.optionalString(dto.rendererJs) ?? null,
          ...this.optionalJson('meta', dto.meta),
          ...this.optionalJson('rendererConfig', dto.rendererConfig),
          ...(liftedAiConfig
            ? { aiConfig: liftedAiConfig as Prisma.InputJsonValue }
            : this.optionalJson('aiConfig', dto.aiConfig)),
          ...this.optionalJson('fieldPrompts', dto.fieldPrompts),
        },
      });

      this.logger.log(
        `worksheet template created id=${template.id} slug=${template.slug}`,
      );

      return {
        id: template.id,
        name: template.name,
        slug: template.slug,
        category: template.category,
        status: template.status,
        version: template.version,
        rendererType: template.rendererType,
        backgroundAssetId: backgroundAsset.id,
        sampleAssetId: sampleAsset.id,
        backgroundUrl: backgroundAsset.url,
        sampleUrl: sampleAsset.url,
        aiEditConfigJs: template.aiEditConfigJs,
        aiEditPopupHtml: template.aiEditPopupHtml,
        aiEditPanelJs: template.aiEditPanelJs,
        editorJs: template.editorJs,
        fieldEditorJs: template.fieldEditorJs,
        rendererJs: template.rendererJs,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new WorksheetException(
          'INVALID_REQUEST',
          `Worksheet template slug "${slug}" already exists`,
          HttpStatus.CONFLICT,
          { field: 'slug' },
        );
      }
      throw error;
    }
  }

  public async getActiveByIdOrSlug(idOrSlug: string): Promise<WorksheetTemplateRecord> {
    const template = await this.prisma.worksheetTemplate.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
      },
    });

    if (!template) {
      throw new WorksheetException(
        'TEMPLATE_NOT_FOUND',
        `Worksheet template "${idOrSlug}" was not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    if (template.status !== 'ACTIVE') {
      throw new WorksheetException(
        'TEMPLATE_NOT_FOUND',
        `Worksheet template "${idOrSlug}" is not active`,
        HttpStatus.NOT_FOUND,
      );
    }

    return template;
  }

  public async getById(id: string): Promise<WorksheetTemplateRecord> {
    const template = await this.prisma.worksheetTemplate.findUnique({
      where: { id },
    });
    if (!template) {
      throw new WorksheetException(
        'TEMPLATE_NOT_FOUND',
        `Worksheet template "${id}" was not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return template;
  }

  public async listActive(): Promise<WorksheetTemplateRecord[]> {
    return this.prisma.worksheetTemplate.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
  }

  public toCatalogItem(template: WorksheetTemplateRecord) {
    const meta = this.parseMeta(template);
    return {
      id: template.id,
      name: template.name,
      slug: template.slug,
      category: template.category,
      description: template.description,
      meta,
      sampleUrl: template.sampleAssetId
        ? `${this.assetImagePath}/${template.sampleAssetId}/image`
        : null,
      ...this.parseAiEditUi(template),
    };
  }

  public async listCatalog() {
    const templates = await this.listActive();
    return templates.map((template) => this.toCatalogItem(template));
  }

  public parseMeta(template: WorksheetTemplateRecord): WorksheetTemplateMeta {
    return (parseJsonObject(template.meta) ?? {}) as WorksheetTemplateMeta;
  }

  public parseAiConfig(template: WorksheetTemplateRecord): WorksheetAiConfig {
    return (parseJsonObject(template.aiConfig) ?? {}) as WorksheetAiConfig;
  }

  public parseFieldPrompts(template: WorksheetTemplateRecord): WorksheetFieldPrompts {
    const raw = parseJsonObject(template.fieldPrompts) ?? {};
    const flat: WorksheetFieldPrompts = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith('_')) continue;
      if (typeof value === 'string') {
        flat[key] = value;
        continue;
      }
      if (value && typeof value === 'object' && 'prompt' in value) {
        const prompt = (value as { prompt?: unknown }).prompt;
        if (typeof prompt === 'string') flat[key] = prompt;
      }
    }
    return flat;
  }

  public parseFieldPromptMeta(
    template: WorksheetTemplateRecord,
  ): Record<string, { label?: string; autoRegenerateAfter?: string[] }> {
    const raw = parseJsonObject(template.fieldPrompts) ?? {};
    const meta: Record<string, { label?: string; autoRegenerateAfter?: string[] }> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!value || typeof value !== 'object' || key.startsWith('_')) continue;
      const item = value as {
        label?: string;
        auto_regenerate_after?: string[];
      };
      meta[key] = {
        label: typeof item.label === 'string' ? item.label : undefined,
        autoRegenerateAfter: Array.isArray(item.auto_regenerate_after)
          ? item.auto_regenerate_after
          : undefined,
      };
    }
    return meta;
  }

  public parseAiEditUi(template: WorksheetTemplateRecord): {
    aiEditPopupHtml: string | null;
    aiEditConfigJs: string | null;
    aiEditPanelJs: string | null;
  } {
    return {
      aiEditPopupHtml: this.optionalString(template.aiEditPopupHtml) ?? null,
      aiEditConfigJs: this.optionalString(template.aiEditConfigJs) ?? null,
      aiEditPanelJs: this.optionalString(template.aiEditPanelJs) ?? null,
    };
  }

  public parseRendererConfig(
    template: WorksheetTemplateRecord,
  ): WorksheetRendererConfig {
    return (parseJsonObject(template.rendererConfig) ?? {}) as WorksheetRendererConfig;
  }

  private async uploadTemplateImage(
    file: UploadedTemplateImage,
    role: 'background' | 'sample',
  ): Promise<{ id: string; url: string }> {
    const validation = await this.imageProcessor.validateImage(
      file.buffer,
      WORKSHEET_TEMPLATE_IMAGE_MAX_BYTES,
    );
    if (!validation.isValid) {
      throw new WorksheetException(
        'INVALID_REQUEST',
        `${role} image is invalid: ${validation.error}`,
        HttpStatus.BAD_REQUEST,
        { field: role },
      );
    }

    const mimeType = validation.mimeType || file.mimetype;
    if (!WORKSHEET_TEMPLATE_IMAGE_MIME_TYPES.has(mimeType)) {
      throw new WorksheetException(
        'INVALID_REQUEST',
        `${role} image must be jpeg, png, webp, or gif`,
        HttpStatus.BAD_REQUEST,
        { field: role, mimeType },
      );
    }

    const contentHash = await this.imageProcessor.calculateSha256(file.buffer);
    const existing = await this.prisma.asset.findUnique({
      where: { contentHash },
      select: { id: true, s3ObjectKey: true, s3Bucket: true },
    });

    if (existing) {
      const url = await this.s3StorageService.getSignedUrl(
        existing.s3ObjectKey,
        this.signedUrlTtlSeconds,
        existing.s3Bucket,
      );
      this.logger.log(
        `reusing existing asset ${existing.id} for worksheet template ${role} image`,
      );
      return { id: existing.id, url };
    }

    const extension = this.extensionForMime(mimeType);
    const filename = this.safeFilename(file.originalname, `${role}.${extension}`);
    const placeholderId = `ws-tmpl-${role}-${contentHash.slice(0, 12)}`;
    const objectKey = this.s3StorageService.generateCanonicalKey(
      placeholderId,
      filename,
    );

    const uploaded = await this.s3StorageService.uploadFile(file.buffer, {
      key: objectKey,
      contentType: mimeType,
      metadata: {
        role,
        originalName: filename,
      },
    });

    const created = await this.prisma.asset.create({
      data: {
        contentHash,
        mimeType,
        fileSize: BigInt(file.buffer.length),
        width: validation.width ?? null,
        height: validation.height ?? null,
        s3Bucket: uploaded.bucket,
        s3ObjectKey: uploaded.key,
        status: 'STORED_IN_S3',
      },
    });

    const url = await this.s3StorageService.getSignedUrl(
      created.s3ObjectKey,
      this.signedUrlTtlSeconds,
      created.s3Bucket,
    );

    return { id: created.id, url };
  }

  private liftAiConfigFromStructure(
    structureDefinition: Record<string, unknown>,
    explicit: unknown,
  ): Record<string, unknown> | null {
    const provided = parseJsonField(explicit, 'aiConfig');
    const nested = parseJsonObject(structureDefinition.ai_config);
    const editableFields = parseJsonObject(structureDefinition.editable_fields);
    if (!provided && !nested && !editableFields) {
      return null;
    }
    return {
      ...(nested ?? {}),
      ...(editableFields ? { editable_fields: editableFields } : {}),
      ...(provided ?? {}),
      aiEditable:
        (provided as WorksheetAiConfig | null)?.aiEditable ??
        (Array.isArray(nested?.ai_editable) ? nested.ai_editable : undefined) ??
        (nested as WorksheetAiConfig | null)?.aiEditable,
    };
  }

  private optionalJson(
    field: 'meta' | 'rendererConfig' | 'aiConfig' | 'fieldPrompts',
    value: unknown,
  ): Partial<Record<typeof field, Prisma.InputJsonValue>> {
    const parsed = parseJsonField(value, field);
    if (!parsed) {
      return {};
    }
    return { [field]: parsed as Prisma.InputJsonValue };
  }

  private requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new WorksheetException(
        'INVALID_REQUEST',
        `${field} is required`,
        HttpStatus.BAD_REQUEST,
        { field },
      );
    }
    return value.trim();
  }

  private optionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }

  private normalizeSlug(slug: string): string {
    const normalized = slug.trim().toLowerCase().replace(/\s+/g, '_');
    if (!/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(normalized)) {
      throw new WorksheetException(
        'INVALID_REQUEST',
        'slug must contain only lowercase letters, numbers, hyphens, or underscores',
        HttpStatus.BAD_REQUEST,
        { field: 'slug' },
      );
    }
    return normalized;
  }

  private parseStatus(
    value: unknown,
  ): 'DRAFT' | 'ACTIVE' | 'INACTIVE' {
    if (value === undefined || value === null || value === '') {
      return 'ACTIVE';
    }
    const status = String(value).trim().toUpperCase();
    if (!TEMPLATE_STATUSES.has(status)) {
      throw new WorksheetException(
        'INVALID_REQUEST',
        'status must be DRAFT, ACTIVE, or INACTIVE',
        HttpStatus.BAD_REQUEST,
        { field: 'status' },
      );
    }
    return status as 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  }

  private parseVersion(value: unknown): number {
    if (value === undefined || value === null || value === '') {
      return 1;
    }
    const version = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(version) || version < 1) {
      throw new WorksheetException(
        'INVALID_REQUEST',
        'version must be a positive integer',
        HttpStatus.BAD_REQUEST,
        { field: 'version' },
      );
    }
    return version;
  }

  private extensionForMime(mimeType: string): string {
    if (mimeType === 'image/jpeg') return 'jpg';
    if (mimeType === 'image/png') return 'png';
    if (mimeType === 'image/webp') return 'webp';
    if (mimeType === 'image/gif') return 'gif';
    return 'bin';
  }

  private safeFilename(original: string, fallback: string): string {
    const base = original?.split(/[/\\]/).pop()?.trim() || fallback;
    const sanitized = base.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    return sanitized || fallback;
  }
}

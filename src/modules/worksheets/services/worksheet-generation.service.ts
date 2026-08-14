import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { GenerateWorksheetDto } from '../dto/generate-worksheet.dto';
import { GenerateWorksheetResponse } from '../types/worksheet.types';
import { asStructureRecord } from '../utils/structure.util';
import { WorksheetAssetService } from './worksheet-asset.service';
import { WorksheetContentService } from './worksheet-content.service';
import { WorksheetTemplateSelectionService } from './worksheet-template-selection.service';
import { WorksheetTemplateService } from './worksheet-template.service';
import { WorksheetValidationService } from './worksheet-validation.service';

@Injectable()
export class WorksheetGenerationService {
  private readonly logger = new Logger(WorksheetGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly validationService: WorksheetValidationService,
    private readonly templateSelectionService: WorksheetTemplateSelectionService,
    private readonly templateService: WorksheetTemplateService,
    private readonly contentService: WorksheetContentService,
    private readonly assetService: WorksheetAssetService,
  ) {}

  public async generate(
    dto: GenerateWorksheetDto,
  ): Promise<GenerateWorksheetResponse> {
    this.logger.log('worksheet generation started');
    this.validationService.validateRequest(dto);

    const template = await this.templateSelectionService.select(dto);
    this.logger.log(`template selected slug=${template.slug} id=${template.id}`);

    const generated = await this.contentService.generateStructure(template, dto);
    this.logger.log('content generation completed');

    const meta = this.templateService.parseMeta(template);
    const ageGroups =
      meta.ageMin != null && meta.ageMax != null
        ? [`${meta.ageMin}-${meta.ageMax}`]
        : undefined;

    const { structure } = await this.assetService.attachAssets(generated, {
      grades: dto.grade ? [dto.grade] : meta.grades,
      ageGroups,
    });
    this.logger.log('asset retrieval completed');

    const validated = this.validationService.validateGeneratedStructure(
      structure,
      template,
      { allowEnrichmentKeys: true },
    );

    const worksheet = await this.prisma.worksheet.create({
      data: {
        templateId: template.id,
        request: dto as Prisma.InputJsonValue,
        structure: validated as Prisma.InputJsonValue,
        status: 'GENERATED',
      },
    });
    this.logger.log(`worksheet persisted id=${worksheet.id}`);

    return {
      id: worksheet.id,
      status: worksheet.status,
      template: {
        id: template.id,
        slug: template.slug,
        name: template.name,
        rendererType: template.rendererType,
      },
      request: dto,
      structure: asStructureRecord(worksheet.structure),
    };
  }
}

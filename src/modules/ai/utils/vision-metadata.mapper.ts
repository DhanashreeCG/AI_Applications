import { VisionAnalysisResult } from '../../../common/dto/vision-metadata.dto';
import { Prisma } from '@generated/prisma/client';

export function mapVisionAnalysisToAssetMetadata(
  analysis: VisionAnalysisResult,
  searchDescriptionHash: string,
): Omit<
  Prisma.AssetMetadataCreateInput,
  'asset' | 'metadataVersion' | 'createdAt' | 'updatedAt'
> {
  const { metadata } = analysis;

  return {
    caption: metadata.caption,
    objects: metadata.objects,
    actions: metadata.actions,
    styles: metadata.styles,
    colors: metadata.colors,
    background: metadata.background || null,
    composition: metadata.composition || null,
    orientation: metadata.orientation || null,
    ageGroups: metadata.age_groups,
    educationalUses: metadata.educational_uses,
    searchKeywords: metadata.search_keywords,
    searchDescription: analysis.searchDescription,
    searchDescriptionHash,
    rawResponse: analysis.rawResponse as Prisma.InputJsonValue,
    provider: analysis.provider,
    model: analysis.model,
    modelVersion: analysis.modelVersion,
    promptVersion: analysis.promptVersion,
  };
}

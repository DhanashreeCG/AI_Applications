/**
 * Shared helper: upload a local image and set WorksheetTemplate.backgroundAssetId.
 */
import { readFileSync, existsSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { createValidationContext } from '../validate/shared/bootstrap';
import { PrismaService } from '../../src/modules/database/prisma.service';
import { S3StorageService } from '../../src/modules/storage/s3-storage.service';
import { ImageProcessorService } from '../../src/modules/image/image-processor.service';
import {
  WORKSHEET_TEMPLATE_IMAGE_MAX_BYTES,
  WORKSHEET_TEMPLATE_IMAGE_MIME_TYPES,
} from '../../src/modules/worksheets/constants/worksheet.constants';

export type UpdateBackgroundImageInput = {
  templateId: string;
  /** Absolute path, or path relative to the repo root. */
  backgroundImagePath: string;
  /** Filename stem used for the S3 object (e.g. "number-names-background"). */
  assetFilenameStem: string;
};

export async function updateWorksheetTemplateBackgroundImage(
  input: UpdateBackgroundImageInput,
): Promise<void> {
  const backgroundPath = isAbsolute(input.backgroundImagePath)
    ? input.backgroundImagePath
    : resolve(process.cwd(), input.backgroundImagePath);

  if (!backgroundPath.trim() || backgroundPath.includes('REPLACE_WITH')) {
    throw new Error(
      `Set BACKGROUND_IMAGE_PATH at the top of the script before running. Got: ${input.backgroundImagePath}`,
    );
  }
  if (!existsSync(backgroundPath)) {
    throw new Error(`Background image not found: ${backgroundPath}`);
  }

  const buffer = readFileSync(backgroundPath);
  const app = await createValidationContext();

  try {
    const prisma = app.get(PrismaService);
    const s3 = app.get(S3StorageService);
    const imageProcessor = app.get(ImageProcessorService);

    const template = await prisma.worksheetTemplate.findUnique({
      where: { id: input.templateId },
      select: { id: true, slug: true, name: true, backgroundAssetId: true },
    });
    if (!template) {
      throw new Error(`Worksheet template not found: ${input.templateId}`);
    }

    const validation = await imageProcessor.validateImage(
      buffer,
      WORKSHEET_TEMPLATE_IMAGE_MAX_BYTES,
    );
    if (!validation.isValid) {
      throw new Error(`Invalid background image: ${validation.error}`);
    }

    const mimeType = validation.mimeType || 'image/png';
    if (!WORKSHEET_TEMPLATE_IMAGE_MIME_TYPES.has(mimeType)) {
      throw new Error(`Unsupported mime type: ${mimeType}`);
    }

    const contentHash = await imageProcessor.calculateSha256(buffer);
    let backgroundAssetId: string;

    const existing = await prisma.asset.findUnique({
      where: { contentHash },
      select: { id: true },
    });

    if (existing) {
      backgroundAssetId = existing.id;
      console.log(
        `Reusing existing asset ${backgroundAssetId} (content hash match)`,
      );
    } else {
      const extension =
        mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1] || 'png';
      const filename = `${input.assetFilenameStem}.${extension}`;
      const placeholderId = `ws-tmpl-bg-${contentHash.slice(0, 12)}`;
      const objectKey = s3.generateCanonicalKey(placeholderId, filename);

      const uploaded = await s3.uploadFile(buffer, {
        key: objectKey,
        contentType: mimeType,
        metadata: {
          role: 'background',
          originalName: basename(backgroundPath) || filename,
          templateSlug: template.slug,
        },
      });

      const created = await prisma.asset.create({
        data: {
          contentHash,
          mimeType,
          fileSize: BigInt(buffer.length),
          width: validation.width ?? null,
          height: validation.height ?? null,
          s3Bucket: uploaded.bucket,
          s3ObjectKey: uploaded.key,
          status: 'STORED_IN_S3',
        },
      });
      backgroundAssetId = created.id;
      console.log(
        `Uploaded new background asset ${backgroundAssetId} key=${uploaded.key}`,
      );
    }

    const previousBackgroundAssetId = template.backgroundAssetId;
    const updated = await prisma.worksheetTemplate.update({
      where: { id: input.templateId },
      data: { backgroundAssetId },
      select: {
        id: true,
        slug: true,
        name: true,
        backgroundAssetId: true,
        updatedAt: true,
      },
    });

    console.log(
      JSON.stringify(
        {
          id: updated.id,
          slug: updated.slug,
          name: updated.name,
          previousBackgroundAssetId,
          backgroundAssetId: updated.backgroundAssetId,
          backgroundUrl: `/worksheets/assets/${updated.backgroundAssetId}/image`,
          updatedAt: updated.updatedAt,
          sourceFile: backgroundPath,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

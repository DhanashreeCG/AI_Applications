/**
 * Upload public/universal sample.png and set it as the Universal Template sample image.
 * Usage: npx ts-node -r tsconfig-paths/register scripts/update-universal-worksheet-sample-image.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createValidationContext } from './validate/shared/bootstrap';
import { PrismaService } from '../src/modules/database/prisma.service';
import { S3StorageService } from '../src/modules/storage/s3-storage.service';
import { ImageProcessorService } from '../src/modules/image/image-processor.service';
import {
  WORKSHEET_TEMPLATE_IMAGE_MAX_BYTES,
  WORKSHEET_TEMPLATE_IMAGE_MIME_TYPES,
} from '../src/modules/worksheets/constants/worksheet.constants';

const TEMPLATE_ID = 'cmtveqj0x002ltobgwe7d4brc';

async function main(): Promise<void> {
  const samplePath = join(process.cwd(), 'public', 'universal sample.png');
  if (!existsSync(samplePath)) {
    throw new Error(`Sample image not found: ${samplePath}`);
  }

  const buffer = readFileSync(samplePath);
  const app = await createValidationContext();

  try {
    const prisma = app.get(PrismaService);
    const s3 = app.get(S3StorageService);
    const imageProcessor = app.get(ImageProcessorService);

    const template = await prisma.worksheetTemplate.findUnique({
      where: { id: TEMPLATE_ID },
      select: { id: true, slug: true, name: true, sampleAssetId: true },
    });
    if (!template) {
      throw new Error(`Worksheet template not found: ${TEMPLATE_ID}`);
    }

    const validation = await imageProcessor.validateImage(
      buffer,
      WORKSHEET_TEMPLATE_IMAGE_MAX_BYTES,
    );
    if (!validation.isValid) {
      throw new Error(`Invalid sample image: ${validation.error}`);
    }

    const mimeType = validation.mimeType || 'image/png';
    if (!WORKSHEET_TEMPLATE_IMAGE_MIME_TYPES.has(mimeType)) {
      throw new Error(`Unsupported mime type: ${mimeType}`);
    }

    const contentHash = await imageProcessor.calculateSha256(buffer);
    let sampleAssetId: string;

    const existing = await prisma.asset.findUnique({
      where: { contentHash },
      select: { id: true },
    });

    if (existing) {
      sampleAssetId = existing.id;
      console.log(`Reusing existing asset ${sampleAssetId} (content hash match)`);
    } else {
      const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1] || 'png';
      const filename = `universal-sample.${extension}`;
      const placeholderId = `ws-tmpl-sample-${contentHash.slice(0, 12)}`;
      const objectKey = s3.generateCanonicalKey(placeholderId, filename);

      const uploaded = await s3.uploadFile(buffer, {
        key: objectKey,
        contentType: mimeType,
        metadata: {
          role: 'sample',
          originalName: filename,
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
      sampleAssetId = created.id;
      console.log(`Uploaded new sample asset ${sampleAssetId} key=${uploaded.key}`);
    }

    const previousSampleAssetId = template.sampleAssetId;
    const updated = await prisma.worksheetTemplate.update({
      where: { id: TEMPLATE_ID },
      data: { sampleAssetId },
      select: {
        id: true,
        slug: true,
        name: true,
        sampleAssetId: true,
        updatedAt: true,
      },
    });

    console.log(
      JSON.stringify(
        {
          id: updated.id,
          slug: updated.slug,
          name: updated.name,
          previousSampleAssetId,
          sampleAssetId: updated.sampleAssetId,
          sampleUrl: `/worksheets/assets/${updated.sampleAssetId}/image`,
          updatedAt: updated.updatedAt,
          sourceFile: samplePath,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

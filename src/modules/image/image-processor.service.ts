import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { Readable } from 'stream';
import { ImageValidationResult } from './interfaces/image-validation.interface';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require('sharp') as typeof import('sharp');

@Injectable()
export class ImageProcessorService {
  private readonly logger = new Logger(ImageProcessorService.name);

  public async calculateSha256(input: Buffer | Readable): Promise<string> {
    const hash = crypto.createHash('sha256');

    if (Buffer.isBuffer(input)) {
      hash.update(input);
      return hash.digest('hex');
    }

    return new Promise((resolve, reject) => {
      input.on('data', (chunk) => hash.update(chunk));
      input.on('end', () => resolve(hash.digest('hex')));
      input.on('error', (err) => reject(err));
    });
  }

  public async validateImage(
    buffer: Buffer,
    maxSizeBytes = 50 * 1024 * 1024,
  ): Promise<ImageValidationResult> {
    const size = buffer.length;
    if (size === 0) {
      return { isValid: false, size: 0, error: 'Empty file buffer' };
    }

    if (size > maxSizeBytes) {
      return {
        isValid: false,
        size,
        error: `File size ${size} exceeds maximum limit of ${maxSizeBytes} bytes`,
      };
    }

    try {
      const metadata = await sharp(buffer).metadata();

      if (!metadata.format || !metadata.width || !metadata.height) {
        return {
          isValid: false,
          size,
          error: 'Unable to parse image dimensions or format. File may be corrupted.',
        };
      }

      let orientation: 'portrait' | 'landscape' | 'square' = 'landscape';
      if (metadata.width === metadata.height) {
        orientation = 'square';
      } else if (metadata.height > metadata.width) {
        orientation = 'portrait';
      }

      const mimeType = this.formatToMimeType(metadata.format);

      return {
        isValid: true,
        format: metadata.format,
        mimeType,
        width: metadata.width,
        height: metadata.height,
        size,
        orientation,
      };
    } catch (error: any) {
      this.logger.error(`Sharp image validation failed: ${error.message}`);
      return {
        isValid: false,
        size,
        error: `Corrupted or invalid image file: ${error.message}`,
      };
    }
  }

  public async generateAiOptimizedRepresentation(
    buffer: Buffer,
    maxDimension = 1024,
    quality = 85,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width || maxDimension;
    const height = metadata.height || maxDimension;

    let sharpInstance = sharp(buffer);

    if (width > maxDimension || height > maxDimension) {
      sharpInstance = sharpInstance.resize({
        width: width > height ? maxDimension : undefined,
        height: height >= width ? maxDimension : undefined,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    const outputBuffer = await sharpInstance
      .jpeg({ quality, progressive: true })
      .toBuffer();

    return {
      buffer: outputBuffer,
      mimeType: 'image/jpeg',
    };
  }

  private formatToMimeType(format: string): string {
    switch (format.toLowerCase()) {
      case 'jpeg':
      case 'jpg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'gif':
        return 'image/gif';
      case 'tiff':
        return 'image/tiff';
      case 'svg':
        return 'image/svg+xml';
      default:
        return `image/${format}`;
    }
  }
}

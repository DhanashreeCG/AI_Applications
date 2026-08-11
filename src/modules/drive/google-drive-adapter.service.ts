import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import {
  assertValidPrivateKeyPem,
  normalizePrivateKey,
} from '../../common/utils/normalize-private-key.util';
import { DriveFileItem } from './interfaces/drive-file.interface';

interface ServiceAccountCredentials {
  client_email?: string;
  private_key?: string;
}

@Injectable()
export class GoogleDriveAdapterService {
  private readonly logger = new Logger(GoogleDriveAdapterService.name);
  private driveClient: drive_v3.Drive | null = null;

  constructor(private readonly configService: ConfigService) {
    this.initDriveClient();
  }

  private initDriveClient(): void {
    const credentialsPath = this.configService.get<string>(
      'googleDrive.credentialsPath',
    );
    const clientEmail = this.configService.get<string>('googleDrive.clientEmail');
    const privateKeyRaw = this.configService.get<string>('googleDrive.privateKey');
    const apiKey = this.configService.get<string>('googleDrive.apiKey');

    const fromFile = credentialsPath
      ? this.loadCredentialsFromFile(credentialsPath)
      : null;

    const email = fromFile?.client_email ?? clientEmail;
    const privateKey = fromFile?.private_key
      ? normalizePrivateKey(fromFile.private_key)
      : privateKeyRaw
        ? normalizePrivateKey(privateKeyRaw)
        : undefined;

    if (email && privateKey) {
      assertValidPrivateKeyPem(privateKey);

      try {
        const auth = new google.auth.JWT({
          email,
          key: privateKey,
          scopes: ['https://www.googleapis.com/auth/drive.readonly'],
        });
        this.driveClient = google.drive({ version: 'v3', auth });
        this.logger.log(
          fromFile
            ? `Google Drive Service Account loaded from ${credentialsPath}`
            : 'Google Drive Service Account JWT authentication initialized',
        );
      } catch (error) {
        throw this.wrapCredentialError(error);
      }
    } else if (apiKey) {
      this.driveClient = google.drive({ version: 'v3', auth: apiKey });
      this.logger.log('Google Drive API Key authentication initialized');
    } else {
      this.logger.warn('Google Drive credentials not provided. Mocking/Unit test mode.');
    }
  }

  private loadCredentialsFromFile(
    credentialsPath: string,
  ): ServiceAccountCredentials {
    const absolutePath = resolve(credentialsPath);

    try {
      const raw = readFileSync(absolutePath, 'utf8');
      const parsed = JSON.parse(raw) as ServiceAccountCredentials;

      if (!parsed.client_email || !parsed.private_key) {
        throw new Error(
          'Service account JSON must include client_email and private_key',
        );
      }

      return parsed;
    } catch (error) {
      if (error instanceof Error && error.message.includes('client_email')) {
        throw error;
      }

      throw new Error(
        `Failed to read Google Drive credentials from ${absolutePath}: ${(error as Error).message}`,
      );
    }
  }

  private wrapCredentialError(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('DECODER routines::unsupported')) {
      return new Error(
        'Invalid GOOGLE_DRIVE_PRIVATE_KEY format. Use GOOGLE_DRIVE_CREDENTIALS_PATH pointing to the downloaded service account JSON file, or paste the full PEM on one line with \\n escapes between lines.',
      );
    }

    return error instanceof Error ? error : new Error(message);
  }

  public setDriveClient(client: drive_v3.Drive): void {
    this.driveClient = client;
  }

  public async listFilesInFolderRecursive(
    rootFolderId: string,
    currentPath = '',
  ): Promise<DriveFileItem[]> {
    if (!this.driveClient) {
      throw new Error('Google Drive client is not initialized');
    }

    const items: DriveFileItem[] = [];

    try {
      await this.scanFolder(rootFolderId, currentPath, items);
    } catch (error) {
      throw this.wrapCredentialError(error);
    }

    return items;
  }

  private async scanFolder(
    folderId: string,
    currentPath: string,
    acc: DriveFileItem[],
  ): Promise<void> {
    if (!this.driveClient) return;

    let pageToken: string | undefined = undefined;
    const query = `'${folderId}' in parents and trashed = false`;

    do {
      const response: any = await this.executeWithRetry(() =>
        this.driveClient!.files.list({
          q: query,
          fields: 'nextPageToken, files(id, name, mimeType, size, createdTime)',
          pageSize: 100,
          pageToken,
        }),
      );

      const files = response.data.files || [];
      pageToken = response.data.nextPageToken || undefined;

      for (const file of files) {
        if (!file.id || !file.name || !file.mimeType) continue;

        if (file.mimeType === 'application/vnd.google-apps.folder') {
          const subFolderPath = currentPath
            ? `${currentPath}/${file.name}`
            : file.name;
          await this.scanFolder(file.id, subFolderPath, acc);
        } else if (this.isSupportedImageMimeType(file.mimeType)) {
          acc.push({
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            size: file.size ? BigInt(file.size) : undefined,
            folderPath: currentPath,
            createdAt: file.createdTime ? new Date(file.createdTime) : undefined,
          });
        }
      }
    } while (pageToken);
  }

  public async downloadFileStream(fileId: string): Promise<Readable> {
    if (!this.driveClient) {
      throw new Error('Google Drive client is not initialized');
    }

    const response: any = await this.executeWithRetry(() =>
      this.driveClient!.files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream' },
      ),
    );

    return response.data as Readable;
  }

  private isSupportedImageMimeType(mimeType: string): boolean {
    const supported = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/tiff',
      'image/bmp',
      'image/svg+xml',
    ];
    return supported.includes(mimeType.toLowerCase()) || mimeType.startsWith('image/');
  }

  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    baseDelayMs = 1000,
  ): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (error: any) {
        attempt++;
        const status = error?.status || error?.response?.status;
        const isRateLimitOrServerError =
          status === 429 || (status >= 500 && status <= 599);

        if (!isRateLimitOrServerError || attempt >= maxRetries) {
          throw error;
        }

        const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 200;
        this.logger.warn(
          `Google Drive API error (${status}). Retrying attempt ${attempt}/${maxRetries} in ${Math.round(delay)}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { v2 } from '@google-cloud/translate';
import {
  assertValidPrivateKeyPem,
  normalizePrivateKey,
} from '../../../common/utils/normalize-private-key.util';
import {
  TranslationProduct,
  TranslationProvider,
} from '../interfaces/translation.interfaces';

type TranslateClient = InstanceType<typeof v2.Translate>;

interface ServiceAccountCredentials {
  client_email?: string;
  private_key?: string;
  project_id?: string;
}

/**
 * Google Cloud Translation (v2) with service-account credentials.
 * Reuses GOOGLE_TRANSLATION_* or falls back to GOOGLE_DRIVE_* SA credentials.
 * AI Studio / Gemini API keys are NOT used (Cloud Translation rejects API keys).
 */
@Injectable()
export class GcpTranslationProvider
  implements TranslationProvider, OnModuleInit
{
  private readonly logger = new Logger(GcpTranslationProvider.name);
  private client: TranslateClient | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.initClient();
  }

  isReady(_product?: TranslationProduct): boolean {
    return Boolean(this.client);
  }

  async translateTexts(
    texts: string[],
    targetLanguage: string,
    sourceLanguage: string,
    mimeType: 'text/plain' | 'text/html' = 'text/plain',
    _product: TranslationProduct = 'flashcards',
  ): Promise<string[]> {
    if (!texts.length) {
      return [];
    }

    if (!this.client) {
      throw new Error(
        'GCP Translation client is not configured. Set GOOGLE_TRANSLATION_* or GOOGLE_DRIVE service-account credentials.',
      );
    }

    const [result] = await this.client.translate(texts, {
      from: sourceLanguage,
      to: targetLanguage,
      format: mimeType === 'text/html' ? 'html' : 'text',
    });

    const translations = Array.isArray(result) ? result : [result];
    if (translations.length !== texts.length) {
      throw new Error(
        `GCP Translation returned ${translations.length} results for ${texts.length} inputs`,
      );
    }

    return translations.map((item, index) => {
      if (typeof item !== 'string') {
        throw new Error(`Missing translated text at index ${index}`);
      }
      return item;
    });
  }

  private initClient(): void {
    const enabled =
      this.configService.get<boolean>('translation.enabled') !== false;
    if (!enabled) {
      this.logger.warn('Translation is disabled by configuration');
      return;
    }

    const credentialsPath =
      this.configService.get<string>('translation.credentialsPath') ||
      this.configService.get<string>('googleDrive.credentialsPath');
    const clientEmail =
      this.configService.get<string>('translation.clientEmail') ||
      this.configService.get<string>('googleDrive.clientEmail');
    const privateKeyRaw =
      this.configService.get<string>('translation.privateKey') ||
      this.configService.get<string>('googleDrive.privateKey');

    const fromFile = credentialsPath
      ? this.loadCredentialsFromFile(credentialsPath)
      : null;

    const email = fromFile?.client_email ?? clientEmail;
    const privateKey = fromFile?.private_key
      ? normalizePrivateKey(fromFile.private_key)
      : privateKeyRaw
        ? normalizePrivateKey(privateKeyRaw)
        : undefined;

    const projectId =
      this.configService.get<string>('translation.projectId') ||
      fromFile?.project_id ||
      undefined;

    if (!email || !privateKey) {
      this.logger.warn(
        'GCP Translation credentials not provided (need service-account email + private key via GOOGLE_TRANSLATION_* or GOOGLE_DRIVE_*). Translation unavailable.',
      );
      return;
    }

    try {
      assertValidPrivateKeyPem(privateKey);
      this.client = new v2.Translate({
        projectId,
        credentials: {
          client_email: email,
          private_key: privateKey,
        },
      });
      this.logger.log(
        fromFile && credentialsPath
          ? `GCP Translation ready (service account from ${credentialsPath}${projectId ? `, project=${projectId}` : ''})`
          : `GCP Translation ready (service account env credentials${projectId ? `, project=${projectId}` : ''})`,
      );
    } catch (error) {
      this.client = null;
      this.logger.error(
        `Failed to initialize GCP Translation client: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private loadCredentialsFromFile(
    credentialsPath: string,
  ): ServiceAccountCredentials {
    const absolutePath = resolve(credentialsPath);
    const raw = readFileSync(absolutePath, 'utf8');
    const parsed = JSON.parse(raw) as ServiceAccountCredentials;

    if (!parsed.client_email || !parsed.private_key) {
      throw new Error(
        'Service account JSON must include client_email and private_key',
      );
    }

    return parsed;
  }
}

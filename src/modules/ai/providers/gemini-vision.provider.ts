import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import {
  VisionAnalysisResult,
  VisionMetadataDto,
} from '../../../common/dto/vision-metadata.dto';
import {
  VisionProvider,
  VisionProviderInput,
} from '../../../common/interfaces/vision-provider.interface';
import {
  DEFAULT_GEMINI_VISION_MODEL,
  DEFAULT_VISION_PROMPT_VERSION,
  VISION_ANALYSIS_PROMPT,
  VISION_METADATA_JSON_SCHEMA,
} from '../constants/vision-prompt.constants';
import { buildSearchDescription } from '../utils/search-description.builder';
import { parseVisionMetadata } from '../utils/vision-metadata.parser';

@Injectable()
export class GeminiVisionProvider implements VisionProvider {
  readonly providerName = 'google-gemini';
  readonly modelName: string;
  readonly modelVersion: string;

  private readonly logger = new Logger(GeminiVisionProvider.name);
  private client: GoogleGenAI | null;
  private readonly defaultPromptVersion: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('ai.geminiApiKey');
    this.modelName =
      this.configService.get<string>('ai.geminiModel') ||
      DEFAULT_GEMINI_VISION_MODEL;
    this.modelVersion = this.modelName;
    this.defaultPromptVersion =
      this.configService.get<string>('ai.geminiPromptVersion') ||
      DEFAULT_VISION_PROMPT_VERSION;

    if (apiKey) {
      this.client = new GoogleGenAI({ apiKey });
      this.logger.log(
        `Gemini vision provider initialized with model ${this.modelName}`,
      );
    } else {
      this.client = null;
      this.logger.warn(
        'GEMINI_API_KEY not provided. GeminiVisionProvider is unavailable.',
      );
    }
  }

  public setClient(client: GoogleGenAI): void {
    this.client = client;
  }

  public async analyzeImage(
    input: VisionProviderInput,
  ): Promise<VisionAnalysisResult> {
    if (!this.client) {
      throw new Error('Gemini vision client is not initialized');
    }

    const promptVersion = input.promptVersion || this.defaultPromptVersion;
    const base64Image = input.imageBuffer.toString('base64');

    const response = await this.client.models.generateContent({
      model: this.modelName,
      contents: [
        {
          role: 'user',
          parts: [
            { text: VISION_ANALYSIS_PROMPT },
            {
              inlineData: {
                mimeType: input.mimeType,
                data: base64Image,
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: VISION_METADATA_JSON_SCHEMA,
      },
    });

    const responseText = response.text?.trim();
    if (!responseText) {
      throw new Error('Gemini vision response did not contain JSON metadata');
    }

    let parsedResponse: unknown;
    try {
      parsedResponse = JSON.parse(responseText);
    } catch {
      throw new Error('Gemini vision response was not valid JSON');
    }

    const metadata = parseVisionMetadata(parsedResponse);
    const searchDescription = buildSearchDescription(metadata);

    return {
      metadata,
      searchDescription,
      rawResponse: parsedResponse as Record<string, unknown>,
      provider: this.providerName,
      model: this.modelName,
      modelVersion: this.modelVersion,
      promptVersion,
    };
  }

  public buildSearchDescription(metadata: VisionMetadataDto): string {
    return buildSearchDescription(metadata);
  }
}

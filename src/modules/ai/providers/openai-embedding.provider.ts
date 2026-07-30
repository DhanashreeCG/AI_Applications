import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  EmbeddingProvider,
  EmbeddingResult,
} from '../../../common/interfaces/embedding-provider.interface';
import {
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  OPENAI_EMBEDDING_DIMENSIONS,
} from '../constants/embedding.constants';
import { hashSourceText } from '../utils/source-text-hash.util';

@Injectable()
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = 'openai';
  readonly modelName: string;
  readonly dimensions = OPENAI_EMBEDDING_DIMENSIONS;

  private readonly logger = new Logger(OpenAiEmbeddingProvider.name);
  private client: OpenAI | null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('ai.openaiApiKey');
    this.modelName =
      this.configService.get<string>('ai.openaiEmbeddingModel') ||
      DEFAULT_OPENAI_EMBEDDING_MODEL;

    if (apiKey) {
      this.client = new OpenAI({ apiKey });
      this.logger.log(
        `OpenAI embedding provider initialized with model ${this.modelName}`,
      );
    } else {
      this.client = null;
      this.logger.warn(
        'OPENAI_API_KEY not provided. OpenAiEmbeddingProvider is unavailable.',
      );
    }
  }

  public setClient(client: OpenAI): void {
    this.client = client;
  }

  public async generateEmbedding(text: string): Promise<EmbeddingResult> {
    if (!this.client) {
      throw new Error('OpenAI embedding client is not initialized');
    }

    const normalizedText = text.trim();
    if (!normalizedText) {
      throw new Error('Embedding input text cannot be empty');
    }

    const sourceTextHash = hashSourceText(normalizedText);

    const response = await this.client.embeddings.create({
      model: this.modelName,
      input: normalizedText,
    });

    const embedding = response.data[0]?.embedding;
    if (!embedding) {
      throw new Error('OpenAI embedding response did not contain vector data');
    }

    if (embedding.length !== this.dimensions) {
      throw new Error(
        `Expected ${this.dimensions}-dim embedding, received ${embedding.length}`,
      );
    }

    return {
      embedding,
      dimensions: embedding.length,
      provider: this.providerName,
      model: this.modelName,
      sourceTextHash,
    };
  }
}

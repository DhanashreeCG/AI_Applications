import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { OpenAiEmbeddingProvider } from '../ai/providers/openai-embedding.provider';
import { VectorStorageService } from './vector-storage.service';
import { SearchAssetsDto } from './dto/search-assets.dto';
import {
  SearchAssetsResponse,
  SearchResultItem,
} from './interfaces/search-result.interface';
import { matchesMetadataFilters } from './utils/metadata-filter.util';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly defaultLimit = 10;
  private readonly candidateMultiplier = 5;
  private readonly minimumCandidates = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingProvider: OpenAiEmbeddingProvider,
    private readonly vectorStorage: VectorStorageService,
  ) {}

  public async search(dto: SearchAssetsDto): Promise<SearchAssetsResponse> {
    const query = dto.query?.trim();
    if (!query) {
      throw new BadRequestException('Search query cannot be empty');
    }

    const limit = dto.limit ?? this.defaultLimit;
    if (limit <= 0) {
      throw new BadRequestException('limit must be greater than 0');
    }

    const candidateLimit = Math.max(limit * this.candidateMultiplier, this.minimumCandidates);

    this.logger.log(`Searching assets for query: "${query}"`);

    const embedding = await this.embeddingProvider.generateEmbedding(query);
    const vectorResults = await this.vectorStorage.searchSimilar(
      embedding.embedding,
      candidateLimit,
    );

    if (vectorResults.length === 0) {
      return {
        query,
        total: 0,
        results: [],
      };
    }

    const assetIds = vectorResults.map((result) => result.assetId);
    const assets = await this.prisma.asset.findMany({
      where: {
        id: { in: assetIds },
        metadata: { isNot: null },
      },
      include: { metadata: true },
    });

    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
    const filteredResults: SearchResultItem[] = [];

    for (const vectorResult of vectorResults) {
      const asset = assetMap.get(vectorResult.assetId);
      if (!asset?.metadata) {
        continue;
      }

      if (!matchesMetadataFilters(asset.metadata, dto.filters)) {
        continue;
      }

      filteredResults.push({
        assetId: asset.id,
        similarity: vectorResult.similarity,
        distance: vectorResult.distance,
        caption: asset.metadata.caption,
        orientation: asset.metadata.orientation,
        colors: asset.metadata.colors,
        styles: asset.metadata.styles,
        objects: asset.metadata.objects,
        actions: asset.metadata.actions,
        ageGroups: asset.metadata.ageGroups,
        searchDescription: asset.metadata.searchDescription,
        s3ObjectKey: asset.s3ObjectKey,
        mimeType: asset.mimeType,
      });

      if (filteredResults.length >= limit) {
        break;
      }
    }

    return {
      query,
      total: filteredResults.length,
      results: filteredResults,
    };
  }
}

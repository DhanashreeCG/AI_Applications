import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SearchMetadataFiltersDto {
  @ApiPropertyOptional()
  orientation?: string;

  @ApiPropertyOptional({ type: [String] })
  colors?: string[];

  @ApiPropertyOptional({ type: [String] })
  styles?: string[];

  @ApiPropertyOptional({ type: [String] })
  objects?: string[];

  @ApiPropertyOptional({ type: [String] })
  actions?: string[];

  @ApiPropertyOptional({ type: [String] })
  ageGroups?: string[];

  @ApiPropertyOptional({ type: [String] })
  grades?: string[];

  @ApiPropertyOptional({ type: [String] })
  educationalUses?: string[];

  @ApiPropertyOptional()
  background?: string;
}

export class SearchAssetsDto {
  @ApiProperty({ example: 'cartoon elephant' })
  query!: string;

  @ApiPropertyOptional({
    example: 'IN',
    description:
      'ISO country code for content restrictions. Overrides FLASHCARD_DEFAULT_COUNTRY_CODE.',
  })
  countryCode?: string;

  @ApiPropertyOptional({ example: 10, default: 10 })
  limit?: number;

  @ApiPropertyOptional({ type: SearchMetadataFiltersDto })
  filters?: SearchMetadataFiltersDto;

  @ApiPropertyOptional({ example: false })
  bypassCache?: boolean;

  /** Use `limit` as the vector window instead of the default 50-candidate over-fetch. */
  retrieval?: boolean;

  /** Override the pgvector topK window. */
  candidateLimit?: number;

  /** Skip per-asset Redis metadata writes after hydrate. */
  skipMetadataCacheWrite?: boolean;
}

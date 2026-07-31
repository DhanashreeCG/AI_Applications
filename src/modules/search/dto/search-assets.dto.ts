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

  @ApiPropertyOptional({ example: 10, default: 10 })
  limit?: number;

  @ApiPropertyOptional({ type: SearchMetadataFiltersDto })
  filters?: SearchMetadataFiltersDto;

  @ApiPropertyOptional({ example: false })
  bypassCache?: boolean;
}

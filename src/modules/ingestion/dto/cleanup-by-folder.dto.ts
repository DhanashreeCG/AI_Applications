import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CleanupByFolderDto {
  @ApiProperty({
    example: '1aBcDeFgHiJkLmNoPqRsTuVwXyZ',
    description: 'Google Drive root folder id used when creating the ingestion job',
  })
  rootFolderId!: string;

  @ApiPropertyOptional({
    default: true,
    description:
      'When true (default), only report what would be deleted. Set false to apply.',
  })
  dryRun?: boolean;

  @ApiPropertyOptional({
    default: true,
    description: 'Also delete IngestionJob rows for this rootFolderId',
  })
  deleteJobs?: boolean;

  @ApiPropertyOptional({
    default: true,
    description:
      'Skip assets that also have AssetSource links from other root folders',
  })
  skipSharedAssets?: boolean;
}

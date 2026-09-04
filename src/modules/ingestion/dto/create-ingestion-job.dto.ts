import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type IngestionJobMode = 'FULL' | 'DRY_RUN';

export class CreateIngestionJobDto {
  @ApiProperty({ example: 'GOOGLE_DRIVE', default: 'GOOGLE_DRIVE' })
  readonly sourceType = 'GOOGLE_DRIVE' as const;

  @ApiProperty({ example: '1aBcDeFgHiJkLmNoPqRsTuVwXyZ' })
  rootFolderId!: string;

  @ApiPropertyOptional({
    enum: ['FULL', 'DRY_RUN'],
    default: 'FULL',
    description: 'DRY_RUN = hash/dedup/estimate only (no S3/AI/SQS)',
  })
  mode?: IngestionJobMode;

  @ApiPropertyOptional({
    default: false,
    description:
      'When true, Gemini vision uses each file name as the source of truth for ambiguous letters/digits (o/O/0). Default leaves vision-only behavior unchanged.',
  })
  readFileNames?: boolean;
}

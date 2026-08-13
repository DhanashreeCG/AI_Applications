import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AssetState } from '../../../common/enums/asset-state.enum';

export class ReplayStuckDto {
  @ApiProperty({
    enum: AssetState,
    example: AssetState.STORED_IN_S3,
    description:
      'Current stuck status to select (Asset and/or IngestionFile). ' +
      'Examples: STORED_IN_S3, METADATA_GENERATED, DEAD_LETTER, FAILED.',
  })
  status!: AssetState;

  @ApiPropertyOptional({
    enum: AssetState,
    description:
      'Stage to resume from. Defaults: STORED_IN_S3→GENERATING_METADATA, ' +
      'METADATA_GENERATED→GENERATING_EMBEDDING. For DEAD_LETTER/FAILED, ' +
      'derived from last failed attempt when omitted.',
  })
  failedStage?: AssetState;

  @ApiPropertyOptional({
    default: 500,
    description: 'Max number of files to enqueue in this call (1–2000)',
  })
  limit?: number;

  @ApiPropertyOptional({
    default: true,
    description:
      'When true (default), only report matches. Set false to enqueue replays.',
  })
  dryRun?: boolean;
}

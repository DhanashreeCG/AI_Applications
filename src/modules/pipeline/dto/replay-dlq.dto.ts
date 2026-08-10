import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AssetState } from '../../../common/enums/asset-state.enum';

export class ReplayDlqDto {
  @ApiProperty({
    example: 'cmscwhpwt0005rkbgu78bhvc5',
    description: 'IngestionFile to replay. Every other field can be derived.',
  })
  ingestionFileId!: string;

  @ApiPropertyOptional({
    description: 'Defaults to the job that owns the ingestion file',
  })
  jobId?: string;

  @ApiPropertyOptional({
    description: 'Defaults to the asset linked to the ingestion file',
  })
  assetId?: string;

  @ApiPropertyOptional({
    enum: AssetState,
    description:
      'Stage to resume from. Defaults to the stage of the last failed attempt, ' +
      'falling back to DISCOVERED so the file is reprocessed from the start.',
  })
  failedStage?: AssetState;

  @ApiPropertyOptional()
  traceId?: string;

  @ApiPropertyOptional({ description: 'Carried into logs only; replay always resets the attempt counter to 1' })
  attempt?: number;

  @ApiPropertyOptional()
  errorCode?: string;

  @ApiPropertyOptional()
  errorMessage?: string;

  @ApiPropertyOptional()
  stackTrace?: string;

  @ApiPropertyOptional()
  timestamp?: string;
}

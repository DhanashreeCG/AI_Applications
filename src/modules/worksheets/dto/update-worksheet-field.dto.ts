import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateWorksheetFieldDto {
  @ApiProperty({ example: 'instruction' })
  path!: string;

  @ApiProperty({ example: 'Count the fruit.' })
  value!: unknown;
}

export class SearchWorksheetImagesQueryDto {
  @ApiPropertyOptional({ example: 'two goats on a farm' })
  query?: string;

  @ApiPropertyOptional({
    example: 'image',
    description: 'Image slot path; used to default query from imageQuery when query is omitted',
  })
  path?: string;

  @ApiPropertyOptional({ example: 10 })
  limit?: number;

  @ApiPropertyOptional({ example: 'IN' })
  countryCode?: string;
}

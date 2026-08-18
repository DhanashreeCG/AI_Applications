import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegenerateWorksheetDto {
  @ApiProperty({
    example: 'Make the questions about farm animals and keep the same age group.',
    description: 'Requirements for regenerating this worksheet on the same template',
  })
  query!: string;

  @ApiPropertyOptional({ example: 'Farm animals' })
  topic?: string;
}

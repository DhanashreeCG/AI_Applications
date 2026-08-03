import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateFlashcardsDto {
  @ApiProperty({
    example: 'Generate flashcards on vegetables',
    description: 'Natural-language user query describing what flashcards to create',
  })
  query!: string;

  @ApiProperty({
    example: '3-4',
    description: 'Learner age group as min-max (e.g. "3-4", "5-6")',
  })
  ageGroup!: string;

  @ApiPropertyOptional({ example: 5, default: 5 })
  count?: number;
}

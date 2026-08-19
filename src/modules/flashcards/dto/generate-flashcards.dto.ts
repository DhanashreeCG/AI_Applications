import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateFlashcardsDto {
  @ApiProperty({
    example: 'Generate 12 flashcards on vegetables for Grade 1',
    description:
      'Natural-language user query describing what flashcards to create',
  })
  query!: string;

  @ApiPropertyOptional({
    example: '5-6',
    description:
      'Learner age group as min-max (e.g. "3-4", "5-6"). Optional when grade is present in the query or grade field.',
  })
  ageGroup?: string;

  @ApiPropertyOptional({
    example: 'Grade 1',
    description: 'Explicit grade override (highest selection priority)',
  })
  grade?: string;

  @ApiPropertyOptional({
    example: 'EVS',
    description: 'Subject override (e.g. EVS, Math, English)',
  })
  subject?: string;

  @ApiPropertyOptional({
    example: 'beginner',
    description: 'Difficulty override: beginner | intermediate | advanced',
  })
  difficulty?: string;

  @ApiPropertyOptional({
    example: 'English',
    description: 'Content language (default English)',
  })
  language?: string;

  @ApiPropertyOptional({ example: 5, default: 5 })
  count?: number;

  @ApiPropertyOptional({
    example: 'tmpl_image_word_sentence',
    description:
      'When set, skips objective determination and template selection and uses this template directly',
  })
  templateId?: string;

  @ApiPropertyOptional({
    example: 'IN',
    description:
      'ISO 3166-1 alpha-2 country code. When omitted, FLASHCARD_DEFAULT_COUNTRY_CODE is used on the server. A request value always overrides the env default.',
  })
  countryCode?: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateContentRestrictionDto {
  @ApiProperty({ example: 'pork' })
  term!: string;

  @ApiProperty({ example: 'BANNED', enum: ['BANNED', 'RESTRICTED'] })
  severity!: 'BANNED' | 'RESTRICTED';

  @ApiPropertyOptional({
    example: '*',
    description: 'ISO 3166-1 alpha-2, or * for global',
  })
  countryCode?: string;

  @ApiPropertyOptional({
    example: 'ANIMAL_FOOD',
    enum: ['ANIMAL_FOOD', 'VISUAL_MOTIF', 'RELIGIOUS', 'OTHER'],
  })
  category?: 'ANIMAL_FOOD' | 'VISUAL_MOTIF' | 'RELIGIOUS' | 'OTHER';

  @ApiPropertyOptional({ example: true })
  active?: boolean;

  @ApiPropertyOptional({ example: 'Saudi Arabia pork ban' })
  notes?: string;
}

export class UpdateContentRestrictionDto {
  @ApiPropertyOptional({ example: 'pork' })
  term?: string;

  @ApiPropertyOptional({ example: 'BANNED', enum: ['BANNED', 'RESTRICTED'] })
  severity?: 'BANNED' | 'RESTRICTED';

  @ApiPropertyOptional({ example: 'SA' })
  countryCode?: string;

  @ApiPropertyOptional({
    example: 'ANIMAL_FOOD',
    enum: ['ANIMAL_FOOD', 'VISUAL_MOTIF', 'RELIGIOUS', 'OTHER'],
  })
  category?: 'ANIMAL_FOOD' | 'VISUAL_MOTIF' | 'RELIGIOUS' | 'OTHER';

  @ApiPropertyOptional({ example: true })
  active?: boolean;

  @ApiPropertyOptional({ example: 'Saudi Arabia pork ban' })
  notes?: string | null;
}

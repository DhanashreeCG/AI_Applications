import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One layout-only flashcard template.
 * `id` is never accepted — Prisma generates a cuid.
 */
export class UploadFlashcardTemplateDto {
  @ApiProperty({ example: 'classification_v1' })
  name!: string;

  @ApiPropertyOptional({ example: 'Classify the object' })
  description?: string;

  @ApiProperty({ example: 'CLASSIFICATION' })
  templateType!: string;

  @ApiProperty({ example: 'VERTICAL' })
  layoutType!: string;

  @ApiProperty({
    example: ['5-6', '6-8'],
    description: 'Age bands this template supports (e.g. "3-4")',
    type: [String],
  })
  supportedAgeGroups!: string[];

  @ApiPropertyOptional({ example: [], type: [String] })
  supportedGrades?: string[];

  @ApiProperty({
    example: ['Classification'],
    type: [String],
  })
  learningObjectives!: string[];

  @ApiPropertyOptional({ example: ['General', 'Science'], type: [String] })
  subjectsSupported?: string[];

  @ApiPropertyOptional({ example: ['Intermediate'], type: [String] })
  difficultyLevels?: string[];

  @ApiPropertyOptional({ example: ['classification', 'sorting'], type: [String] })
  tags?: string[];

  @ApiPropertyOptional({ example: 'A6', default: 'A6' })
  pageSize?: string;

  @ApiPropertyOptional({ example: 'PORTRAIT', default: 'PORTRAIT' })
  orientation?: string;

  @ApiProperty({
    description:
      'Region-based layout. Mark editable components with editable: true on the component itself (no separate editableComponents array).',
    example: {
      regions: [
        {
          id: 'body',
          components: [{ id: 'image', type: 'image', editable: true }],
        },
        {
          id: 'footer',
          components: [{ id: 'categories', type: 'chips', editable: true }],
        },
      ],
    },
  })
  layoutDefinition!: Record<string, unknown>;

  @ApiPropertyOptional({ example: null })
  thumbnail?: string | null;

  @ApiPropertyOptional({
    example: false,
    default: false,
    description:
      'Opt-in template (e.g. letter/digit tracing). Never auto-selected unless the request explicitly asks for it.',
  })
  requiresExplicitRequest?: boolean;

  @ApiPropertyOptional({
    example: ['tracing', 'letters', 'numbers'],
    type: [String],
    description:
      'Query terms that count as explicitly asking for this template. Defaults to tags + templateType.',
  })
  explicitRequestKeywords?: string[];

  @ApiPropertyOptional({ example: '1.0', default: '1.0' })
  templateVersion?: string;

  @ApiPropertyOptional({ example: true, default: true })
  active?: boolean;
}

/**
 * Batch upload body. Send one or many templates under `templates`.
 *
 * Example:
 * ```json
 * {
 *   "templates": [
 *     {
 *       "name": "classification_v1",
 *       "description": "Classify the object",
 *       "templateType": "CLASSIFICATION",
 *       "layoutType": "VERTICAL",
 *       "supportedAgeGroups": ["5-6", "6-8"],
 *       "learningObjectives": ["Classification"],
 *       "subjectsSupported": ["General", "Science"],
 *       "difficultyLevels": ["Intermediate"],
 *       "tags": ["classification", "sorting"],
 *       "pageSize": "A6",
 *       "orientation": "PORTRAIT",
 *       "layoutDefinition": {
 *         "regions": [
 *           {
 *             "id": "body",
 *             "components": [
 *               { "id": "image", "type": "image", "editable": true }
 *             ]
 *           },
 *           {
 *             "id": "footer",
 *             "components": [
 *               { "id": "categories", "type": "chips", "editable": true }
 *             ]
 *           }
 *         ]
 *       },
 *       "templateVersion": "1.0",
 *       "active": true
 *     }
 *   ]
 * }
 * ```
 */
export class UploadFlashcardTemplatesDto {
  @ApiProperty({
    type: [UploadFlashcardTemplateDto],
    description: 'One or more templates to create (ids are auto-generated)',
  })
  templates!: UploadFlashcardTemplateDto[];
}

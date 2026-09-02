import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWorksheetTemplateDto {
  @ApiProperty({ example: 'Counting Objects' })
  name!: string;

  @ApiProperty({ example: 'counting_objects_v1' })
  slug!: string;

  @ApiProperty({ example: 'numeracy' })
  category!: string;

  @ApiPropertyOptional({ example: 'Count pictured objects and write the number.' })
  description?: string;

  @ApiPropertyOptional({
    enum: ['DRAFT', 'ACTIVE', 'INACTIVE'],
    example: 'ACTIVE',
    default: 'ACTIVE',
  })
  status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional({ example: 1, default: 1 })
  version?: number;

  @ApiProperty({
    example:
      '<h1>{{instruction}}</h1>{{#items}}<img src="{{assetUrl}}" /><p>{{count}}</p>{{/items}}',
  })
  templateHtml!: string;

  @ApiProperty({
    description:
      'JSON Schema for generated content. Multipart clients may send this as a JSON string.',
    example: {
      type: 'object',
      required: ['instruction', 'items'],
      additionalProperties: false,
      properties: {
        instruction: { type: 'string' },
        items: { type: 'array', minItems: 4, maxItems: 4 },
      },
    },
  })
  structureDefinition!: Record<string, unknown> | string;

  @ApiPropertyOptional({
    example: {
      grades: ['LKG', 'UKG'],
      subjects: ['Math'],
      topics: ['Counting'],
      ageMin: 3,
      ageMax: 6,
      difficulty: ['easy'],
    },
  })
  meta?: Record<string, unknown> | string;

  @ApiPropertyOptional({ example: 'generic', default: 'generic' })
  rendererType?: string;

  @ApiPropertyOptional({ example: { width: 794, height: 1123 } })
  rendererConfig?: Record<string, unknown> | string;

  @ApiPropertyOptional({
    example: { editableFields: ['instruction', 'items'] },
  })
  aiConfig?: Record<string, unknown> | string;

  @ApiPropertyOptional({
    example: { instruction: 'Keep the instruction to one short sentence.' },
  })
  fieldPrompts?: Record<string, unknown> | string;

  @ApiPropertyOptional({
    example: 'You edit a single worksheet field. Return JSON {"value": ...} only.',
  })
  aiSystemPrompt?: string;

  @ApiPropertyOptional({
    description: 'Raw source of ai-edit-config.js (buildInstruction).',
  })
  aiEditConfigJs?: string;

  @ApiPropertyOptional({
    description: 'Raw HTML for the template-specific AI edit popup fields.',
  })
  aiEditPopupHtml?: string;

  @ApiPropertyOptional({
    description: 'Raw source of ai-edit-panel.js when the template uses a custom panel.',
  })
  aiEditPanelJs?: string;

  @ApiPropertyOptional({
    description: 'Raw source of editor.js (getEditableFields / applyEditorChanges).',
  })
  editorJs?: string;

  @ApiPropertyOptional({
    description: 'Raw source of field-editor.js (resolveField / getFieldPrompt).',
  })
  fieldEditorJs?: string;

  @ApiPropertyOptional({
    description: 'Raw source of renderer.js when a custom renderer is stored with the template.',
  })
  rendererJs?: string;
}

export class CreateWorksheetTemplateResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  category!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  rendererType!: string;

  @ApiProperty()
  backgroundAssetId!: string;

  @ApiProperty()
  sampleAssetId!: string;

  @ApiPropertyOptional()
  backgroundUrl?: string;

  @ApiPropertyOptional()
  sampleUrl?: string;

  @ApiPropertyOptional()
  aiEditConfigJs?: string | null;

  @ApiPropertyOptional()
  aiEditPopupHtml?: string | null;

  @ApiPropertyOptional()
  aiEditPanelJs?: string | null;

  @ApiPropertyOptional()
  editorJs?: string | null;

  @ApiPropertyOptional()
  fieldEditorJs?: string | null;

  @ApiPropertyOptional()
  rendererJs?: string | null;
}

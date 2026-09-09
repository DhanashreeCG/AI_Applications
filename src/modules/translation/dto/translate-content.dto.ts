import { ApiProperty } from '@nestjs/swagger';

export class TranslateContentDto {
  @ApiProperty({
    example: 'mr',
    description:
      'Target language BCP-47 code (e.g. mr, hi, es). Source is always English (en).',
  })
  language!: string;

  @ApiProperty({
    description:
      'Complete generated flashcard or worksheet JSON to translate. English remains canonical; this body is not persisted.',
    type: 'object',
    additionalProperties: true,
    example: {
      cards: [
        {
          cardId: 'card-1',
          cardIndex: 0,
          components: [
            {
              componentId: 'title',
              type: 'title',
              componentType: 'title',
              editable: true,
              content: 'Lion',
            },
          ],
        },
      ],
    },
  })
  content!: Record<string, unknown>;
}

import { ApiProperty } from '@nestjs/swagger';

export class ReplaceWorksheetImageDto {
  @ApiProperty({
    example: 'image',
    description: 'Path of the image slot object that holds assetId, e.g. image or items[0]',
  })
  path!: string;

  @ApiProperty({ example: 'classet0001' })
  assetId!: string;
}

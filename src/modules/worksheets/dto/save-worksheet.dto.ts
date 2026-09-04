import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SaveWorksheetFieldDto {
  @ApiProperty({ example: 'instruction' })
  path!: string;

  @ApiProperty({ example: 'Count the fruit.' })
  value!: unknown;
}

export class SaveWorksheetImageDto {
  @ApiProperty({ example: 'image' })
  path!: string;

  @ApiPropertyOptional({
    example: 'classet0001',
    description: 'Library asset id. Null when the slot uses a user upload.',
    nullable: true,
  })
  assetId?: string | null;

  @ApiPropertyOptional({
    example: 'worksheets/uploads/ws-1/abc.png',
    description: 'S3 object key for a user-uploaded image',
  })
  userUploadedKey?: string;
}

export class SaveWorksheetDto {
  @ApiPropertyOptional({ type: [SaveWorksheetFieldDto] })
  fields?: SaveWorksheetFieldDto[];

  @ApiPropertyOptional({ type: [SaveWorksheetImageDto] })
  images?: SaveWorksheetImageDto[];
}

export class CreateIngestionJobDto {
  readonly sourceType = 'GOOGLE_DRIVE' as const;
  rootFolderId!: string;
}

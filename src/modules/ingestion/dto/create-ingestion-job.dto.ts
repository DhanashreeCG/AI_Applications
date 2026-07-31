export type IngestionJobMode = 'FULL' | 'DRY_RUN';

export class CreateIngestionJobDto {
  readonly sourceType = 'GOOGLE_DRIVE' as const;
  rootFolderId!: string;
  /** FULL runs the pipeline; DRY_RUN hashes/dedups only and returns cost estimate. */
  mode?: IngestionJobMode;
}

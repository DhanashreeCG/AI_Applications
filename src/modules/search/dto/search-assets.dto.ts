export class SearchMetadataFiltersDto {
  orientation?: string;
  colors?: string[];
  styles?: string[];
  objects?: string[];
  actions?: string[];
  ageGroups?: string[];
  grades?: string[];
  educationalUses?: string[];
  background?: string;
}

export class SearchAssetsDto {
  query!: string;
  limit?: number;
  filters?: SearchMetadataFiltersDto;
  bypassCache?: boolean;
}

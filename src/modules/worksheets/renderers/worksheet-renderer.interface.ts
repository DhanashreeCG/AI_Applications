export interface WorksheetRenderer {
  readonly type: string;
  render(input: {
    templateHtml: string;
    structure: Record<string, unknown>;
    rendererConfig?: Record<string, unknown> | null;
    backgroundAssetUrl?: string | null;
  }): string;
}

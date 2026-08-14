import { WorksheetRenderInput } from '../types/worksheet.types';

export interface WorksheetRenderer {
  readonly type: string;
  render(input: WorksheetRenderInput): string;
}

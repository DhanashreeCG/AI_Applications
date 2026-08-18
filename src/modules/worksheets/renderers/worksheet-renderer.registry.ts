import { HttpStatus, Injectable } from '@nestjs/common';
import { WorksheetException } from '../errors/worksheet.exception';
import { GENERIC_RENDERER_TYPE } from '../constants/worksheet.constants';
import { GenericWorksheetRenderer } from './generic-worksheet.renderer';
import { WorksheetRenderer } from './worksheet-renderer.interface';

@Injectable()
export class WorksheetRendererRegistry {
  private readonly renderers = new Map<string, WorksheetRenderer>();

  constructor(genericRenderer: GenericWorksheetRenderer) {
    this.register(genericRenderer);
  }

  public register(renderer: WorksheetRenderer): void {
    this.renderers.set(renderer.type, renderer);
  }

  public get(rendererType: string): WorksheetRenderer {
    const type = rendererType?.trim() || GENERIC_RENDERER_TYPE;
    const renderer = this.renderers.get(type);
    if (!renderer) {
      throw new WorksheetException(
        'UNSUPPORTED_RENDERER',
        `No trusted renderer registered for type "${type}"`,
        HttpStatus.BAD_REQUEST,
        { rendererType: type },
      );
    }
    return renderer;
  }
}

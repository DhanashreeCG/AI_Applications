import { HttpStatus, Injectable } from '@nestjs/common';
import { WorksheetException } from '../errors/worksheet.exception';
import { GENERIC_RENDERER_TYPE } from '../constants/worksheet.constants';
import { GenericWorksheetRenderer } from './generic-worksheet.renderer';
import { CircleTheThingsRenderer } from './circle-the-things.renderer';
import { WorksheetRenderer } from './worksheet-renderer.interface';

@Injectable()
export class WorksheetRendererRegistry {
  private readonly renderers = new Map<string, WorksheetRenderer>();

  constructor(
    private readonly genericRenderer: GenericWorksheetRenderer,
    private readonly circleTheThingsRenderer: CircleTheThingsRenderer,
  ) {
    this.register(this.genericRenderer);
    this.register(this.circleTheThingsRenderer);
    this.registerAlias('number_names', GENERIC_RENDERER_TYPE);
    this.registerAlias('answer_and_colour', GENERIC_RENDERER_TYPE);
  }

  public register(renderer: WorksheetRenderer): void {
    this.renderers.set(renderer.type, renderer);
  }

  public registerAlias(alias: string, type: string): void {
    const renderer = this.renderers.get(type);
    if (renderer) {
      this.renderers.set(alias, renderer);
    }
  }

  public get(rendererType: string, slug?: string): WorksheetRenderer {
    const slugKey = slug?.trim();
    if (slugKey && slugKey !== GENERIC_RENDERER_TYPE && this.renderers.has(slugKey)) {
      return this.renderers.get(slugKey)!;
    }
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

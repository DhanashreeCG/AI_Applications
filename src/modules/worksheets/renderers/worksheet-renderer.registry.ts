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
    this.registerAlias('circle_the_words', GENERIC_RENDERER_TYPE);
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

  public get(rendererType: string, templateSlug?: string): WorksheetRenderer {
    let type = rendererType?.trim() || GENERIC_RENDERER_TYPE;

    // Fallback: If template is circle_the_things but renderer is generic, force it
    if (templateSlug === 'circle_the_things' && type === GENERIC_RENDERER_TYPE) {
      type = 'circle_the_things';
    }

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

import { ComponentType } from '../../constants/flashcard.constants';
import {
  EditableComponentPayload,
  TemplateLayoutComponent,
} from '../../interfaces/flashcard.interfaces';
import { FlashcardRenderContext } from '../interfaces/render-result.interface';
import {
  renderCalloutComponent,
  renderChipsComponent,
  renderImageComponent,
  renderTextComponent,
} from './components/component-renderers';

export class ComponentRenderer {
  render(
    layoutComponent: TemplateLayoutComponent,
    payload: EditableComponentPayload | undefined,
    context: FlashcardRenderContext,
  ): string {
    if (!payload || payload.content === null) {
      if (layoutComponent.type === 'image') {
        return renderImageComponent(
          {
            componentId: layoutComponent.id,
            type: 'image',
            componentType: 'image',
            editable: layoutComponent.editable !== false,
            content: null,
            assetReference: payload?.assetReference ?? null,
          },
          context,
        );
      }

      return '';
    }

    const componentType = (payload.componentType ||
      layoutComponent.type) as ComponentType;

    switch (componentType) {
      case 'image':
        return renderImageComponent(payload, context);
      case 'title':
        return renderTextComponent(payload, 'u-caption');
      case 'subtitle':
        return renderTextComponent(payload, 'u-subtitle');
      case 'sentence':
        return renderTextComponent(payload, 'u-sentence');
      case 'fact':
        return renderCalloutComponent(payload, '', 'Fact');
      case 'question':
        return renderCalloutComponent(payload, 'q', 'Q');
      case 'answer':
        return renderCalloutComponent(payload, '', 'A');
      case 'badge':
        return renderTextComponent(payload, 'u-badge');
      case 'footer':
        return renderTextComponent(payload, 'u-footer');
      case 'phonics':
      case 'pronunciation':
        return renderTextComponent(payload, 'u-pron');
      case 'chips':
        return renderChipsComponent(payload);
      default:
        context.warnings.push(
          `Unsupported component type "${componentType}" for ${payload.componentId}; skipped`,
        );
        return '';
    }
  }
}

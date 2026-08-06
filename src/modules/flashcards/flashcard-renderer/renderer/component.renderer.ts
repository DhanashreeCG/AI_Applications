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
        return renderTextComponent(payload, 'c-title');
      case 'subtitle':
        return renderTextComponent(payload, 'c-subtitle');
      case 'sentence':
        return renderTextComponent(payload, 'c-sentence');
      case 'fact':
        return renderCalloutComponent(payload, 'c-fact', 'Fact');
      case 'question':
        return renderCalloutComponent(payload, 'c-question', 'Q');
      case 'answer':
        return renderCalloutComponent(payload, 'c-answer', 'A');
      case 'badge':
        return renderTextComponent(payload, 'c-badge');
      case 'footer':
        return renderTextComponent(payload, 'c-footer');
      case 'phonics':
      case 'pronunciation':
        return renderTextComponent(payload, 'c-pron');
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

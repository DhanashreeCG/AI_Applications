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
  renderOptionsComponent,
  renderImageCollectionComponent,
} from './components/component-renderers';

export class ComponentRenderer {
  render(
    layoutComponent: TemplateLayoutComponent,
    payload: EditableComponentPayload | undefined,
    context: FlashcardRenderContext,
    isOverlay = false,
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
          isOverlay,
        );
      }

      return '';
    }

    const componentType = (payload.componentType ||
      layoutComponent.type) as ComponentType;

    const id = (payload.componentId || '').toLowerCase();
    const type = (componentType || '').toLowerCase();

    // Map CSS classes matching textClassForComponent in public/index.html
    let cssClass = 'u-sentence';
    if (id === 'letter' || id === 'number' || type === 'letter' || type === 'number') {
      cssClass = 'uno-hero';
    } else if (id === 'subject') {
      cssClass = 'uno-cat';
    } else if (['title', 'word', 'caption', 'heading'].includes(id) || type === 'title') {
      cssClass = 'u-caption';
    } else if (id === 'subtitle' || type === 'subtitle') {
      cssClass = 'u-subtitle';
    } else if (['sentence', 'supportive_text', 'description', 'body'].includes(id) || type === 'sentence') {
      cssClass = 'u-sentence';
    } else if (['phonics', 'pronunciation'].includes(id) || type === 'phonics' || type === 'pronunciation') {
      cssClass = 'u-pron';
    } else if (['badge', 'label'].includes(id) || type === 'badge') {
      cssClass = 'u-badge';
    } else if (id === 'footer' || type === 'footer') {
      cssClass = 'u-footer';
    }

    switch (type) {
      case 'image':
        return renderImageComponent(payload, context, isOverlay);
      case 'imagecollection':
        return renderImageCollectionComponent(payload, context, isOverlay);
      case 'options':
        return renderOptionsComponent(payload, isOverlay);
      case 'chips':
        return renderChipsComponent(payload, isOverlay);
      case 'fact':
        return renderCalloutComponent(payload, '', 'Fact', isOverlay);
      case 'question':
        return renderCalloutComponent(payload, 'q', 'Q', isOverlay);
      case 'answer':
        return renderCalloutComponent(payload, '', 'A', isOverlay);
      case 'title':
      case 'subtitle':
      case 'sentence':
      case 'badge':
      case 'footer':
      case 'phonics':
      case 'pronunciation':
      case 'letter':
      case 'number':
        return renderTextComponent(payload, cssClass, isOverlay);
      default:
        // Render any unknown type that has content as a text component
        if (payload.content !== null) {
          return renderTextComponent(payload, cssClass, isOverlay);
        }
        context.warnings.push(
          `Unsupported component type "${componentType}" for ${payload.componentId}; skipped`,
        );
        return '';
    }
  }
}

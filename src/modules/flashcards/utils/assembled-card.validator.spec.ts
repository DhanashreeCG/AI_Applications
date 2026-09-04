import { FlashcardException } from '../errors/flashcard.exception';
import {
  EditableComponentPayload,
  TemplateComponentDefinition,
} from '../interfaces/flashcard.interfaces';
import { assertAssembledCardComponents } from './assembled-card.validator';
import { expandDefinitionsForAvailableIds } from './repeat-component.util';

function textComponent(
  componentId: string,
  content: string,
  overrides: Partial<EditableComponentPayload> = {},
): EditableComponentPayload {
  return {
    componentId,
    type: 'fact',
    componentType: 'fact',
    editable: true,
    content,
    ...overrides,
  };
}

function titleComponent(
  componentId: string,
  content: string,
): EditableComponentPayload {
  return {
    componentId,
    type: 'title',
    componentType: 'title',
    editable: true,
    content,
  };
}

describe('expandDefinitionsForAvailableIds', () => {
  it('expands {x} placeholders into concrete ids present in the payload', () => {
    const definitions: TemplateComponentDefinition[] = [
      {
        componentId: 'skillLabel',
        componentType: 'title',
        editable: true,
        required: true,
      },
      {
        componentId: 'num-{x}',
        componentType: 'fact',
        editable: true,
        required: true,
        validationRules: { maxCharacters: 4 },
      },
    ];

    const expanded = expandDefinitionsForAvailableIds(definitions, [
      'skillLabel',
      'num-1',
      'num-3',
      'num-2',
    ]);

    expect(expanded.map((item) => item.componentId)).toEqual([
      'skillLabel',
      'num-1',
      'num-2',
      'num-3',
    ]);
    expect(expanded[1].validationRules).toEqual({ maxCharacters: 4 });
  });

  it('leaves non-{x} definitions unchanged when no indexed ids exist', () => {
    const definitions: TemplateComponentDefinition[] = [
      {
        componentId: 'title_word',
        componentType: 'title',
        editable: true,
        required: true,
      },
      {
        componentId: 'fact_main',
        componentType: 'fact',
        editable: true,
        required: true,
      },
    ];

    const expanded = expandDefinitionsForAvailableIds(definitions, [
      'title_word',
      'fact_main',
    ]);

    expect(expanded.map((item) => item.componentId)).toEqual([
      'title_word',
      'fact_main',
    ]);
  });
});

describe('assertAssembledCardComponents (FINAL_VALIDATION)', () => {
  const exactTemplate: TemplateComponentDefinition[] = [
    {
      componentId: 'title_word',
      componentType: 'title',
      editable: true,
      required: true,
    },
    {
      componentId: 'fact_main',
      componentType: 'fact',
      editable: true,
      required: true,
    },
  ];

  const indexedTemplate: TemplateComponentDefinition[] = [
    {
      componentId: 'skillLabel',
      componentType: 'title',
      editable: true,
      required: true,
    },
    {
      componentId: 'num-{x}',
      componentType: 'fact',
      editable: true,
      required: true,
    },
  ];

  it('accepts exact-id assembled cards unchanged', () => {
    expect(() =>
      assertAssembledCardComponents(
        'card-0',
        [
          titleComponent('title_word', 'Broccoli'),
          textComponent('fact_main', 'Broccoli is green.'),
        ],
        exactTemplate,
      ),
    ).not.toThrow();
  });

  it('still rejects missing exact-id components', () => {
    expect(() =>
      assertAssembledCardComponents(
        'card-0',
        [titleComponent('title_word', 'Broccoli')],
        exactTemplate,
      ),
    ).toThrow(FlashcardException);
  });

  it('accepts contiguous expanded {x} components in template order', () => {
    expect(() =>
      assertAssembledCardComponents(
        'card-0',
        [
          titleComponent('skillLabel', 'Count to three'),
          textComponent('num-1', '1'),
          textComponent('num-2', '2'),
          textComponent('num-3', '3'),
        ],
        indexedTemplate,
      ),
    ).not.toThrow();
  });

  it('rejects gaps in expanded {x} runs with a specific message', () => {
    try {
      assertAssembledCardComponents(
        'card-0',
        [
          titleComponent('skillLabel', 'Count to three'),
          textComponent('num-1', '1'),
          textComponent('num-3', '3'),
        ],
        indexedTemplate,
      );
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(FlashcardException);
      expect((error as FlashcardException).message).toMatch(/num-2 missing/);
    }
  });

  it('rejects a missing required indexed run', () => {
    try {
      assertAssembledCardComponents(
        'card-0',
        [titleComponent('skillLabel', 'Count to three')],
        indexedTemplate,
      );
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(FlashcardException);
      expect((error as FlashcardException).message).toMatch(
        /missing required indexed components for "num-\{x\}"/,
      );
    }
  });

  it('rejects empty content on an expanded required instance', () => {
    try {
      assertAssembledCardComponents(
        'card-0',
        [
          titleComponent('skillLabel', 'Count to three'),
          textComponent('num-1', '1'),
          textComponent('num-2', '   '),
        ],
        indexedTemplate,
      );
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(FlashcardException);
      expect((error as FlashcardException).message).toMatch(
        /required text component "num-2" has no content/,
      );
    }
  });
});

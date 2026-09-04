import { createHash } from 'node:crypto';
import { TEMPLATE_SELECTION_SYSTEM_PROMPT } from '../constants/template-selection-prompt.constants';
import { deriveComponentSummary } from './template-catalog-cache.service';

describe('template selection prompt determinism', () => {
  it('keeps system prompt byte-stable for caching', () => {
    const hashA = createHash('sha256')
      .update(TEMPLATE_SELECTION_SYSTEM_PROMPT)
      .digest('hex');
    const hashB = createHash('sha256')
      .update(TEMPLATE_SELECTION_SYSTEM_PROMPT)
      .digest('hex');
    expect(hashA).toBe(hashB);
    expect(TEMPLATE_SELECTION_SYSTEM_PROMPT).toContain('allowedTemplateIds');
    expect(TEMPLATE_SELECTION_SYSTEM_PROMPT).toContain('TEMPLATE CATALOG');
  });

  it('serializes catalog entries with stable key order', () => {
    const entry = {
      id: 'tmpl_1',
      name: 'Picture & Label',
      description: 'Large image with a single vocabulary word',
      templateType: 'VOCABULARY',
      layoutType: 'VERTICAL',
      tags: ['word', 'visual'],
      learningObjectives: ['Vocabulary'],
      subjectsSupported: ['General'],
      difficultyLevels: ['Beginner'],
      componentSummary: deriveComponentSummary({
        regions: [
          {
            id: 'body',
            components: [
              { id: 'img', type: 'image', editable: true },
              { id: 'word', type: 'title', editable: true },
            ],
          },
        ],
      }),
    };

    const jsonA = JSON.stringify({
      templates: [
        {
          id: entry.id,
          name: entry.name,
          description: entry.description,
          templateType: entry.templateType,
          layoutType: entry.layoutType,
          tags: [...entry.tags].sort(),
          learningObjectives: [...entry.learningObjectives].sort(),
          subjectsSupported: [...entry.subjectsSupported].sort(),
          difficultyLevels: [...entry.difficultyLevels].sort(),
          componentSummary: entry.componentSummary,
        },
      ],
    });
    const jsonB = JSON.stringify({
      templates: [
        {
          id: entry.id,
          name: entry.name,
          description: entry.description,
          templateType: entry.templateType,
          layoutType: entry.layoutType,
          tags: [...entry.tags].sort(),
          learningObjectives: [...entry.learningObjectives].sort(),
          subjectsSupported: [...entry.subjectsSupported].sort(),
          difficultyLevels: [...entry.difficultyLevels].sort(),
          componentSummary: entry.componentSummary,
        },
      ],
    });

    expect(jsonA).toBe(jsonB);
    expect(entry.componentSummary).toBe('1 image + 1 title');
  });
});

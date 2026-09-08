import {
  buildWorksheetContentPrompt,
  sanitizeStructureForRegenPrompt,
} from './worksheet-prompt.constants';

describe('worksheet regen prompt', () => {
  it('omits skill badge, header, and previous pairs from context', () => {
    const sanitized = sanitizeStructureForRegenPrompt({
      topic: 'NUMBER NAMES',
      badge_label: 'Numeracy',
      instruction_text: 'Match the numbers with their word names.',
      pairs: [{ number: '1', name: 'one' }],
    });
    expect(sanitized).not.toHaveProperty('badge_label');
    expect(sanitized).not.toHaveProperty('pairs');
    expect(sanitized?.instruction_text).toContain('word names');
  });

  it('strips previous asset ids so regenerate must search new images', () => {
    const sanitized = sanitizeStructureForRegenPrompt({
      topic: 'Farm',
      image: {
        imageQuery: 'two goats',
        assetId: 'old-asset',
        assetUrl: '/worksheets/assets/old-asset/image',
      },
    });
    expect(sanitized?.image).toEqual({ imageQuery: 'two goats' });
  });

  it('puts AI Edit field entries above leftover context and allows Roman match type', () => {
    const prompt = buildWorksheetContentPrompt({
      request: {
        query: 'Change the topic to "whole numbers". Match type: Roman numeral.',
        topic: 'whole numbers',
        fields: { topic: 'whole numbers', matchType: 'roman_numerals' },
        ageGroup: '4-5',
      },
      templateName: 'Number Names',
      templateSlug: 'number_names',
      structureDefinition: { type: 'object' },
      meta: {},
      currentStructure: {
        topic: 'NUMBER NAMES',
        badge_label: 'WHOLE NUMBERS',
        instruction_text: 'Match the numbers with their word names.',
        pairs: [{ number: '1', name: 'one' }],
      },
    });

    expect(prompt).toContain('topic: whole numbers');
    expect(prompt).toContain('matchType: roman_numerals');
    expect(prompt).toContain('Roman numerals');
    expect(prompt).not.toContain('badge_label');
    expect(prompt).not.toContain('"name": "one"');
  });

  it('requires four distinct words for look-and-say phonics worksheets', () => {
    const prompt = buildWorksheetContentPrompt({
      request: { topic: 'letter A', ageGroup: '4-5' },
      templateName: 'Look and Say Letters and Sounds',
      templateSlug: 'look_and_say_letters_and_sounds',
      structureDefinition: { type: 'object' },
      meta: {},
    });

    expect(prompt).toContain('exactly 4 items[]');
    expect(prompt).toContain('every word must be DIFFERENT');
    expect(prompt).toContain('no "Ant" + "ant"');
    expect(prompt).toContain('All 4 imageQuery values must be different');
  });
});

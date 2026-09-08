import {
  AUTHORITATIVE_TEMPLATE_IDS,
  buildStorytimeMazeSelectionProfile,
  CONFIRMED_JSON_SLUG_LINKS,
  resolveAuthoritativeSlug,
} from './worksheet-selection-profile-seed.util';

describe('worksheet-selection-profile-seed resolveAuthoritativeSlug', () => {
  it('resolves unambiguous authoritative slugs', () => {
    expect(resolveAuthoritativeSlug('tracing')).toEqual({ slug: 'tracing' });
    expect(resolveAuthoritativeSlug('match_the_pairs')).toEqual({
      slug: 'match_the_pairs',
    });
    expect(AUTHORITATIVE_TEMPLATE_IDS.tracing).toBe('cmtqs9cbc002nnobgwtdins9u');
  });

  it('skips flagged mismatches by default with closest slug named', () => {
    const a = resolveAuthoritativeSlug('number_names_matching');
    expect(a).toMatchObject({
      skip: true,
      reason: expect.stringContaining('number_names'),
    });

    const b = resolveAuthoritativeSlug('look_and_say_letter_sounds');
    expect(b).toMatchObject({
      skip: true,
      reason: expect.stringContaining('look_and_say_letters_and_sounds'),
    });
  });

  it('links mismatches only when MANUAL override map is provided', () => {
    expect(
      resolveAuthoritativeSlug('number_names_matching', {
        number_names_matching: 'number_names',
      }),
    ).toEqual({ slug: 'number_names' });
  });

  it('CONFIRMED_JSON_SLUG_LINKS resolves both flagged mismatches', () => {
    expect(
      resolveAuthoritativeSlug('number_names_matching', CONFIRMED_JSON_SLUG_LINKS),
    ).toEqual({ slug: 'number_names' });
    expect(
      resolveAuthoritativeSlug(
        'look_and_say_letter_sounds',
        CONFIRMED_JSON_SLUG_LINKS,
      ),
    ).toEqual({ slug: 'look_and_say_letters_and_sounds' });
  });

  it('reports storytime_maze as an authoritative slug that may lack a seed entry', () => {
    expect(AUTHORITATIVE_TEMPLATE_IDS).toHaveProperty('storytime_maze');
    expect(resolveAuthoritativeSlug('storytime_maze')).toEqual({
      slug: 'storytime_maze',
    });
  });
});

describe('buildStorytimeMazeSelectionProfile', () => {
  it('builds profile fields from DB meta description and tags', () => {
    const profile = buildStorytimeMazeSelectionProfile({
      slug: 'storytime_maze',
      name: 'Storytime Maze',
      meta: {
        type: 'storytime_maze',
        description:
          'Story-based maze worksheet where children guide a story character through a maze',
        tags: ['maze', 'story', 'fable', 'animals'],
      },
    });

    expect(profile.templateSlug).toBe('storytime_maze');
    expect(profile.templateType).toBe('storytime_maze');
    expect(profile.description).toContain('guide a story character');
    expect(profile.primaryUse.toLowerCase()).toContain('maze');
    expect(profile.canBeUsedFor).toEqual(
      expect.arrayContaining(['Story time', 'fable', 'animals']),
    );
    expect(profile.adaptationNote.toLowerCase()).toContain('maze');
    expect(profile.skillsPracticed.length).toBeGreaterThan(0);
  });
});

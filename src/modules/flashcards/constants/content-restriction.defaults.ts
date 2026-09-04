export const CONTENT_RESTRICTION_GLOBAL_COUNTRY = '*';

export type ContentRestrictionSeverity = 'BANNED' | 'RESTRICTED';
export type ContentRestrictionCategory =
  | 'ANIMAL_FOOD'
  | 'VISUAL_MOTIF'
  | 'RELIGIOUS'
  | 'OTHER';

export interface ContentRestrictionRecord {
  term: string;
  category: ContentRestrictionCategory;
  severity: ContentRestrictionSeverity;
  countryCode: string;
  active?: boolean;
  notes?: string | null;
}

/** Exact global forbidden list provided for production seed. */
const GLOBAL_FORBIDDEN_TERMS = [
  'god',
  'gods',
  'jesus',
  'christ',
  'allah',
  'muslim',
  'islam',
  'quran',
  'buddha',
  'sikh',
  'jewish',
  'judaism',
  'torah',
  'prayer',
  'worship',
  'angel',
  'saint',
  'holy',
  'sacred',
  'bible',
  'scripture',
  'religion',
  'religious',
  'devil',
  'satan',
  'demon',
  'deity',
  'pastor',
  'nun',
  'monk',
  'heaven',
  'hell',
  'easter',
  'diwali',
  'hanukkah',
  'passover',
  'eid',
  'holi',
  'ramadan',
  'sin',
  'miracle',
  'prophet',
  'apostle',
  'disciple',
  'resurrection',
  'creation',
  'faith',
  'praise',
  'bless',
  'blessed',
  'blessing',
  'redeem',
  'redemption',
  'salvation',
  'almighty',
  'eternal',
  'heavenly',
  'divine',
  'commandment',
  'covenant',
  'gospel',
  'revelation',
  'prophecy',
];

const FORBIDDEN_TERMS_SA = [
  'pig',
  'pigs',
  'piglet',
  'hog',
  'swine',
  'ham',
  'bacon',
  'pork',
  'pepperoni',
  'prosciutto',
  'lard',
];

const FORBIDDEN_TERMS_IN = ['cow', 'cows', 'calf', 'beef', 'veal', 'bull', 'ox'];

const FORBIDDEN_TERMS_IL = [
  'pig',
  'pork',
  'ham',
  'bacon',
  'shellfish',
  'shrimp',
  'lobster',
  'crab',
];

const FORBIDDEN_TERMS_TR = ['pig', 'pork', 'ham', 'bacon'];

function mapTerms(
  terms: string[],
  category: ContentRestrictionCategory,
  severity: ContentRestrictionSeverity,
  countryCode: string,
  notes?: string,
): ContentRestrictionRecord[] {
  return terms.map((term) => ({
    term: term.trim().toLowerCase(),
    category,
    severity,
    countryCode,
    active: true,
    notes: notes ?? null,
  }));
}

/** Default rows seeded into ContentRestrictionTerm when missing. */
export const DEFAULT_CONTENT_RESTRICTIONS: ContentRestrictionRecord[] = [
  ...mapTerms(
    GLOBAL_FORBIDDEN_TERMS,
    'RELIGIOUS',
    'BANNED',
    CONTENT_RESTRICTION_GLOBAL_COUNTRY,
    'Global forbidden terms',
  ),
  ...mapTerms(FORBIDDEN_TERMS_SA, 'ANIMAL_FOOD', 'BANNED', 'SA', 'Saudi Arabia'),
  ...mapTerms(FORBIDDEN_TERMS_IN, 'ANIMAL_FOOD', 'BANNED', 'IN', 'India'),
  ...mapTerms(FORBIDDEN_TERMS_IL, 'ANIMAL_FOOD', 'BANNED', 'IL', 'Israel'),
  ...mapTerms(FORBIDDEN_TERMS_TR, 'ANIMAL_FOOD', 'BANNED', 'TR', 'Turkey'),
];

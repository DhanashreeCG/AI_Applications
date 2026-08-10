import * as fs from 'fs';
import * as path from 'path';
import {
  buildSeedCatalog,
  collectDiagnosticResults,
  DiagnosticCaseInput,
  formatDiagnosticReportMarkdown,
} from '../../src/modules/flashcards/utils/template-selection.diagnostic.util';

const DIAGNOSTIC_CASES: DiagnosticCaseInput[] = [
  {
    label: 'compare keyword',
    query: 'Compare fruits',
    ageGroup: '3-4',
    expectedObjective: 'comparison',
    expectedTemplateId: 'tmpl_image_word_sentence',
  },
  {
    label: 'sort keyword',
    query: 'Sort vegetables by color',
    ageGroup: '5-6',
    expectedObjective: 'sorting',
    expectedTemplateId: 'tmpl_image_word_fact',
  },
  {
    label: 'phonics sound query',
    query: 'What sound does A make?',
    ageGroup: '3-4',
    expectedObjective: 'phonics',
    expectedTemplateId: 'tmpl_image_word_sentence',
  },
  {
    label: 'no keyword age default vocabulary',
    query: 'Generate flashcards on vegetables',
    ageGroup: '3-4',
    expectedObjective: 'vocabulary',
    expectedObjectiveConfidence: 'age_default',
    expectedTemplateId: 'tmpl_image_word_sentence',
  },
  {
    label: 'about noise word does not hijack objective',
    query: 'Flashcards about animals',
    ageGroup: '3-4',
    expectedObjective: 'vocabulary',
    expectedObjectiveConfidence: 'age_default',
    expectedTemplateId: 'tmpl_image_word_sentence',
  },
  {
    label: 'multi-keyword identify and count',
    query: 'Identify and count the animals',
    ageGroup: '3-4',
    expectedObjective: 'counting',
    expectedTemplateId: 'tmpl_image_word_sentence',
  },
  {
    label: 'quiz keyword',
    query: 'Make a quiz about animals',
    ageGroup: '6-8',
    expectedObjective: 'question_answer',
    expectedTemplateId: 'tmpl_image_description_question',
  },
  {
    label: 'science facts',
    query: 'Science facts about planets',
    ageGroup: '5-6',
    expectedObjective: 'science_facts',
    expectedTemplateId: 'tmpl_image_word_fact',
  },
  {
    label: 'recognition age default 2-3',
    query: 'Animals',
    ageGroup: '2-3',
    expectedObjective: 'recognition',
    expectedObjectiveConfidence: 'age_default',
    expectedTemplateId: 'tmpl_large_image_word',
  },
  {
    label: 'general knowledge age default 10-12',
    query: 'World capitals',
    ageGroup: '10-12',
    expectedObjective: 'general_knowledge',
    expectedObjectiveConfidence: 'age_default',
    expectedTemplateId: 'tmpl_image_fact_quiz',
  },
  {
    label: 'match pairs',
    query: 'Match animal pairs',
    ageGroup: '3-4',
    expectedObjective: 'matching',
    expectedTemplateId: 'tmpl_image_word_sentence',
  },
  {
    label: 'classify categories',
    query: 'Classify fruits and vegetables',
    ageGroup: '5-6',
    expectedObjective: 'classification',
    expectedTemplateId: 'tmpl_image_word_fact',
  },
  {
    label: 'reading story',
    query: 'Read a short story about birds',
    ageGroup: '6-8',
    expectedObjective: 'reading',
    expectedTemplateId: 'tmpl_image_description_question',
  },
  {
    label: 'how many counting',
    query: 'How many apples are there?',
    ageGroup: '5-6',
    expectedObjective: 'counting',
    expectedTemplateId: 'tmpl_image_word_fact',
  },
  {
    label: 'difference comparison phrasing',
    query: 'Show the difference between cats and dogs',
    ageGroup: '5-6',
    expectedObjective: 'comparison',
    expectedTemplateId: 'tmpl_image_word_fact',
  },
  {
    label: 'explicit phonics',
    query: 'Generate phonics flashcards for alphabet',
    ageGroup: '4-5',
    expectedObjective: 'phonics',
    expectedTemplateId: 'tmpl_image_word_sentence',
  },
  {
    label: 'spot recognition',
    query: 'Spot the red objects',
    ageGroup: '2-3',
    expectedObjective: 'recognition',
    expectedTemplateId: 'tmpl_large_image_word',
  },
  {
    label: 'grade 1 vegetables EVS',
    query: 'Generate 12 flashcards on vegetables for Grade 1',
    ageGroup: '5-6',
    expectedObjective: 'vocabulary',
    expectedObjectiveConfidence: 'age_default',
    expectedTemplateId: 'tmpl_image_word_fact',
  },
  {
    label: 'vs comparison shorthand',
    query: 'Lion vs tiger',
    ageGroup: '6-8',
    expectedObjective: 'comparison',
    expectedTemplateId: 'tmpl_image_description_question',
  },
  {
    label: 'group sorting phrasing',
    query: 'Group shapes by size',
    ageGroup: '3-4',
    expectedObjective: 'sorting',
    expectedTemplateId: 'tmpl_image_word_sentence',
  },
  {
    label: 'calculate verb counting',
    query: 'Calculate how many stars',
    ageGroup: '5-6',
    expectedObjective: 'counting',
    expectedTemplateId: 'tmpl_image_word_fact',
  },
  {
    label: 'add verb counting',
    query: 'Add the apples',
    ageGroup: '5-6',
    expectedObjective: 'counting',
    expectedTemplateId: 'tmpl_image_word_fact',
  },
  {
    label: 'reading in range phrasing',
    query: 'Reading in range practice',
    ageGroup: '6-8',
    expectedObjective: 'reading',
    expectedTemplateId: 'tmpl_image_description_question',
  },
];

const outputPath = path.join(
  __dirname,
  '../../docs/flashcards/TEMPLATE_SELECTION_RANKING_BREAKDOWN.md',
);

const results = collectDiagnosticResults(DIAGNOSTIC_CASES, buildSeedCatalog());
const markdown = formatDiagnosticReportMarkdown(results);
fs.writeFileSync(outputPath, `${markdown}\n`, 'utf8');

// eslint-disable-next-line no-console
console.log(`Wrote ${results.length} case breakdowns to ${outputPath}`);
const fragile = results.filter((result) => result.fragilePass);
// eslint-disable-next-line no-console
console.log(`Fragile passes: ${fragile.length}`);
for (const result of fragile) {
  // eslint-disable-next-line no-console
  console.log(`  - ${result.label}: ${result.fragileReason}`);
}

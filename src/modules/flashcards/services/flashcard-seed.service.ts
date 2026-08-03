import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TemplateRepository } from './template.repository';

const TEMPLATE_SEEDS: Array<{
  id: string;
  name: string;
  description: string;
  supportedAgeMin: number;
  supportedAgeMax: number;
  learningObjectives: string[];
  subjectsSupported: string[];
  difficultyLevels: string[];
  layoutDefinition: Prisma.InputJsonValue;
  editableComponents: Prisma.InputJsonValue;
  componentHierarchy: Prisma.InputJsonValue;
  renderingHints: Prisma.InputJsonValue;
}> = [
  {
    id: 'tmpl_large_image_word',
    name: 'Large Image + Single Word',
    description: 'Toddler recognition card with one dominant image and a single word.',
    supportedAgeMin: 2,
    supportedAgeMax: 3,
    learningObjectives: ['recognition', 'vocabulary', 'identification'],
    subjectsSupported: [],
    difficultyLevels: ['easy'],
    layoutDefinition: {
      root: 'card',
      slots: [
        { componentId: 'img_main', role: 'hero-image' },
        { componentId: 'title_word', role: 'primary-text' },
      ],
    },
    editableComponents: [
      {
        componentId: 'img_main',
        componentType: 'image',
        editable: true,
        required: true,
      },
      {
        componentId: 'title_word',
        componentType: 'title',
        editable: true,
        required: true,
        validationRules: { maxLength: 24 },
      },
    ],
    componentHierarchy: ['img_main', 'title_word'],
    renderingHints: { imageDominance: 'high', textScale: 'xlarge' },
  },
  {
    id: 'tmpl_image_word_sentence',
    name: 'Large Image + Word + Simple Sentence',
    description: 'Early learner card with word and a simple supporting sentence.',
    supportedAgeMin: 3,
    supportedAgeMax: 4,
    learningObjectives: ['vocabulary', 'recognition', 'reading', 'identification'],
    subjectsSupported: [],
    difficultyLevels: ['easy'],
    layoutDefinition: {
      root: 'card',
      slots: [
        { componentId: 'img_main', role: 'hero-image' },
        { componentId: 'title_word', role: 'primary-text' },
        { componentId: 'sentence_main', role: 'supporting-text' },
      ],
    },
    editableComponents: [
      {
        componentId: 'img_main',
        componentType: 'image',
        editable: true,
        required: true,
      },
      {
        componentId: 'title_word',
        componentType: 'title',
        editable: true,
        required: true,
        validationRules: { maxLength: 32 },
      },
      {
        componentId: 'sentence_main',
        componentType: 'sentence',
        editable: true,
        required: true,
        validationRules: { maxLength: 80 },
      },
    ],
    componentHierarchy: ['img_main', 'title_word', 'sentence_main'],
    renderingHints: { imageDominance: 'high', textScale: 'large' },
  },
  {
    id: 'tmpl_image_word_fact',
    name: 'Image + Word + Educational Fact',
    description: 'Adds a short educational fact for ages 5-6.',
    supportedAgeMin: 5,
    supportedAgeMax: 6,
    learningObjectives: ['science_facts', 'vocabulary', 'general_knowledge'],
    subjectsSupported: ['science', 'general'],
    difficultyLevels: ['easy', 'medium'],
    layoutDefinition: {
      root: 'card',
      slots: [
        { componentId: 'img_main', role: 'hero-image' },
        { componentId: 'title_word', role: 'primary-text' },
        { componentId: 'fact_main', role: 'fact' },
      ],
    },
    editableComponents: [
      {
        componentId: 'img_main',
        componentType: 'image',
        editable: true,
        required: true,
      },
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
        validationRules: { maxLength: 120 },
      },
    ],
    componentHierarchy: ['img_main', 'title_word', 'fact_main'],
    renderingHints: { imageDominance: 'medium', textScale: 'medium' },
  },
  {
    id: 'tmpl_image_description_question',
    name: 'Image + Description + Question',
    description: 'Comprehension-oriented card for ages 6-8.',
    supportedAgeMin: 6,
    supportedAgeMax: 8,
    learningObjectives: ['question_answer', 'reading', 'identification'],
    subjectsSupported: [],
    difficultyLevels: ['medium'],
    layoutDefinition: {
      root: 'card',
      slots: [
        { componentId: 'img_main', role: 'hero-image' },
        { componentId: 'sentence_main', role: 'description' },
        { componentId: 'question_main', role: 'question' },
        { componentId: 'answer_main', role: 'answer' },
      ],
    },
    editableComponents: [
      {
        componentId: 'img_main',
        componentType: 'image',
        editable: true,
        required: true,
      },
      {
        componentId: 'sentence_main',
        componentType: 'sentence',
        editable: true,
        required: true,
      },
      {
        componentId: 'question_main',
        componentType: 'question',
        editable: true,
        required: true,
      },
      {
        componentId: 'answer_main',
        componentType: 'answer',
        editable: true,
        required: true,
      },
    ],
    componentHierarchy: [
      'img_main',
      'sentence_main',
      'question_main',
      'answer_main',
    ],
    renderingHints: { imageDominance: 'medium', textScale: 'medium' },
  },
  {
    id: 'tmpl_image_fact_quiz',
    name: 'Image + Fact + Quiz',
    description: 'Fact + quiz format for ages 8+.',
    supportedAgeMin: 8,
    supportedAgeMax: 14,
    learningObjectives: [
      'question_answer',
      'science_facts',
      'general_knowledge',
      'memory',
    ],
    subjectsSupported: [],
    difficultyLevels: ['medium', 'hard'],
    layoutDefinition: {
      root: 'card',
      slots: [
        { componentId: 'img_main', role: 'hero-image' },
        { componentId: 'fact_main', role: 'fact' },
        { componentId: 'question_main', role: 'quiz-question' },
        { componentId: 'answer_main', role: 'quiz-answer' },
      ],
    },
    editableComponents: [
      {
        componentId: 'img_main',
        componentType: 'image',
        editable: true,
        required: true,
      },
      {
        componentId: 'fact_main',
        componentType: 'fact',
        editable: true,
        required: true,
      },
      {
        componentId: 'question_main',
        componentType: 'question',
        editable: true,
        required: true,
      },
      {
        componentId: 'answer_main',
        componentType: 'answer',
        editable: true,
        required: true,
      },
    ],
    componentHierarchy: [
      'img_main',
      'fact_main',
      'question_main',
      'answer_main',
    ],
    renderingHints: { imageDominance: 'low', textScale: 'small' },
  },
];

const RULE_SEEDS: Array<{
  id: string;
  name: string;
  priority: number;
  ageMin: number;
  ageMax: number;
  learningObjectives: string[];
  templateId: string;
}> = [
  {
    id: 'rule_age_2_3_recognition',
    name: 'Ages 2-3 recognition',
    priority: 100,
    ageMin: 2,
    ageMax: 3,
    learningObjectives: ['recognition', 'vocabulary', 'identification'],
    templateId: 'tmpl_large_image_word',
  },
  {
    id: 'rule_age_3_4_vocabulary',
    name: 'Ages 3-4 vocabulary',
    priority: 100,
    ageMin: 3,
    ageMax: 4,
    learningObjectives: ['vocabulary', 'recognition', 'reading', 'identification'],
    templateId: 'tmpl_image_word_sentence',
  },
  {
    id: 'rule_age_5_6_facts',
    name: 'Ages 5-6 facts',
    priority: 100,
    ageMin: 5,
    ageMax: 6,
    learningObjectives: ['science_facts', 'vocabulary', 'general_knowledge'],
    templateId: 'tmpl_image_word_fact',
  },
  {
    id: 'rule_age_6_8_qa',
    name: 'Ages 6-8 question',
    priority: 100,
    ageMin: 6,
    ageMax: 8,
    learningObjectives: ['question_answer', 'reading', 'identification'],
    templateId: 'tmpl_image_description_question',
  },
  {
    id: 'rule_age_8_plus_quiz',
    name: 'Ages 8+ quiz',
    priority: 100,
    ageMin: 8,
    ageMax: 14,
    learningObjectives: [
      'question_answer',
      'science_facts',
      'general_knowledge',
      'memory',
    ],
    templateId: 'tmpl_image_fact_quiz',
  },
];

@Injectable()
export class FlashcardSeedService implements OnModuleInit {
  private readonly logger = new Logger(FlashcardSeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly templateRepository: TemplateRepository,
  ) {}

  public async onModuleInit(): Promise<void> {
    const existing = await this.templateRepository.countTemplates();
    if (existing > 0) {
      return;
    }

    this.logger.log('Seeding default flashcard templates and selection rules');
    await this.prisma.$transaction(async (tx) => {
      for (const template of TEMPLATE_SEEDS) {
        await tx.flashcardTemplate.create({
          data: {
            ...template,
            templateVersion: '1.0',
            active: true,
            supportedGrades: [],
          },
        });
      }
      for (const rule of RULE_SEEDS) {
        await tx.templateSelectionRule.create({
          data: {
            ...rule,
            active: true,
            grades: [],
            subjects: [],
            difficulties: [],
            intents: [],
            topics: [],
          },
        });
      }
    });
  }
}

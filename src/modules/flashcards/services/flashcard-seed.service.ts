import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { buildRegionLayout } from '../utils/template-layout.util';
import { TemplateRepository } from './template.repository';

const TEMPLATE_SEEDS: Array<{
  id: string;
  name: string;
  description: string;
  templateType: string;
  layoutType: string;
  supportedAgeGroups: string[];
  learningObjectives: string[];
  subjectsSupported: string[];
  difficultyLevels: string[];
  tags: string[];
  pageSize: string;
  orientation: string;
  layoutDefinition: Prisma.InputJsonValue;
}> = [
  {
    id: 'tmpl_large_image_word',
    name: 'Large Image + Single Word',
    description: 'Toddler recognition card with one dominant image and a single word.',
    templateType: 'flashcard',
    layoutType: 'VERTICAL',
    supportedAgeGroups: ['2-3'],
    learningObjectives: ['recognition', 'vocabulary', 'identification'],
    subjectsSupported: [],
    difficultyLevels: ['easy'],
    tags: ['toddler', 'recognition'],
    pageSize: 'A6',
    orientation: 'PORTRAIT',
    layoutDefinition: buildRegionLayout({
      regions: [
        {
          id: 'body',
          components: [
            { id: 'img_main', type: 'image', editable: true },
            {
              id: 'title_word',
              type: 'title',
              editable: true,
              validationRules: { maxLength: 24 },
            },
          ],
        },
      ],
    }),
  },
  {
    id: 'tmpl_image_word_sentence',
    name: 'Large Image + Word + Simple Sentence',
    description: 'Early learner card with word and a simple supporting sentence.',
    templateType: 'flashcard',
    layoutType: 'VERTICAL',
    supportedAgeGroups: ['3-4'],
    learningObjectives: ['vocabulary', 'recognition', 'reading', 'identification'],
    subjectsSupported: [],
    difficultyLevels: ['easy'],
    tags: ['early-learner', 'vocabulary'],
    pageSize: 'A6',
    orientation: 'PORTRAIT',
    layoutDefinition: buildRegionLayout({
      regions: [
        {
          id: 'body',
          components: [
            { id: 'img_main', type: 'image', editable: true },
            {
              id: 'title_word',
              type: 'title',
              editable: true,
              validationRules: { maxLength: 32 },
            },
            {
              id: 'sentence_main',
              type: 'sentence',
              editable: true,
              validationRules: { maxLength: 80 },
            },
          ],
        },
      ],
    }),
  },
  {
    id: 'tmpl_image_word_fact',
    name: 'Image + Word + Educational Fact',
    description: 'Adds a short educational fact for ages 5-6.',
    templateType: 'flashcard',
    layoutType: 'VERTICAL',
    supportedAgeGroups: ['5-6'],
    learningObjectives: ['science_facts', 'vocabulary', 'general_knowledge'],
    subjectsSupported: ['science', 'general'],
    difficultyLevels: ['easy', 'medium'],
    tags: ['facts', 'science'],
    pageSize: 'A6',
    orientation: 'PORTRAIT',
    layoutDefinition: buildRegionLayout({
      regions: [
        {
          id: 'body',
          components: [
            { id: 'img_main', type: 'image', editable: true },
            { id: 'title_word', type: 'title', editable: true },
            {
              id: 'fact_main',
              type: 'fact',
              editable: true,
              validationRules: { maxLength: 120 },
            },
          ],
        },
      ],
    }),
  },
  {
    id: 'tmpl_image_description_question',
    name: 'Image + Description + Question',
    description: 'Comprehension-oriented card for ages 6-8.',
    templateType: 'flashcard',
    layoutType: 'VERTICAL',
    supportedAgeGroups: ['6-8'],
    learningObjectives: ['question_answer', 'reading', 'identification'],
    subjectsSupported: [],
    difficultyLevels: ['medium'],
    tags: ['comprehension', 'qa'],
    pageSize: 'A6',
    orientation: 'PORTRAIT',
    layoutDefinition: buildRegionLayout({
      regions: [
        {
          id: 'body',
          components: [
            { id: 'img_main', type: 'image', editable: true },
            { id: 'sentence_main', type: 'sentence', editable: true },
            { id: 'question_main', type: 'question', editable: true },
            { id: 'answer_main', type: 'answer', editable: true },
          ],
        },
      ],
    }),
  },
  {
    id: 'tmpl_image_fact_quiz',
    name: 'Image + Fact + Quiz',
    description: 'Fact + quiz format for ages 8+.',
    templateType: 'flashcard',
    layoutType: 'VERTICAL',
    supportedAgeGroups: ['8-14'],
    learningObjectives: [
      'question_answer',
      'science_facts',
      'general_knowledge',
      'memory',
    ],
    subjectsSupported: [],
    difficultyLevels: ['medium', 'hard'],
    tags: ['quiz', 'facts'],
    pageSize: 'A6',
    orientation: 'PORTRAIT',
    layoutDefinition: buildRegionLayout({
      regions: [
        {
          id: 'body',
          components: [
            { id: 'img_main', type: 'image', editable: true },
            { id: 'fact_main', type: 'fact', editable: true },
            { id: 'question_main', type: 'question', editable: true },
            { id: 'answer_main', type: 'answer', editable: true },
          ],
        },
      ],
    }),
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

    this.logger.log('No seeding needed here, and not doing it');
    // await this.prisma.$transaction(async (tx) => {
    //   for (const template of TEMPLATE_SEEDS) {
    //     await tx.flashcardTemplate.create({
    //       data: {
    //         ...template,
    //         templateVersion: '1.0',
    //         active: true,
    //         supportedGrades: [],
    //       },
    //     });
    //   }
    //   for (const rule of RULE_SEEDS) {
    //     await tx.templateSelectionRule.create({
    //       data: {
    //         ...rule,
    //         active: true,
    //         grades: [],
    //         subjects: [],
    //         difficulties: [],
    //         intents: [],
    //         topics: [],
    //       },
    //     });
    //   }
    // });
  }
}

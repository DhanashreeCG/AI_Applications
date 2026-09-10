import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { WorksheetException } from '../errors/worksheet.exception';
import {
  TEMPLATE_SELECTION_AI_TOP_N,
  TEMPLATE_SELECTION_MIN_SCORE_MARGIN,
  WORKSHEET_ACTIVITY_TYPES,
  flattenTaxonomySubTopics,
  flattenTaxonomyThemes,
  taxonomyForAgeBand,
} from '../constants/worksheet-template-taxonomy.constants';
import {
  WorksheetTemplateIntentClassification,
  WorksheetTemplateSelectionAiOutcome,
  WorksheetTemplateSelectionTelemetry,
} from '../interfaces/worksheet-template-selection-ai.interfaces';
import {
  GenerateWorksheetRequest,
  WorksheetTemplateMeta,
} from '../types/worksheet.types';
import {
  AgeBand,
  ageBandsOverlap,
  readTemplateAgeRange,
  resolveAgeBand,
} from '../utils/age-band.util';
import {
  WorksheetTemplateRecord,
  WorksheetTemplateService,
} from './worksheet-template.service';
import { WorksheetTemplateSelectionAiService } from './worksheet-template-selection-ai.service';
import { PipelineTelemetryContext } from '../../../common/events/pipeline-tracker.events';

const ACTIVITY_IDENTITY_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'into',
  'from',
  'single',
  'look',
  'say',
]);

@Injectable()
export class WorksheetTemplateSelectionService {
  private readonly logger = new Logger(WorksheetTemplateSelectionService.name);

  constructor(
    private readonly templateService: WorksheetTemplateService,
    private readonly aiService: WorksheetTemplateSelectionAiService,
  ) {}

  public async select(
    request: GenerateWorksheetRequest,
    telemetry?: PipelineTelemetryContext,
  ): Promise<WorksheetTemplateRecord> {
    const explicit = request.templateId?.trim();
    if (explicit) {
      const selected = await this.templateService.getActiveByIdOrSlug(explicit);
      this.attachTelemetry(selected, {
        ageBand: null,
        ageFilteredCount: 1,
        stage2Classification: null,
        rerankTopScores: [{ id: selected.id, slug: selected.slug, score: 0 }],
        scoreMargin: null,
        selectionMode: 'explicit',
        selectionReason: 'explicit_template_id',
      });
      return selected;
    }

    const ageBand = resolveAgeBand(request);
    const templates = await this.templateService.listActive();
    const ageFiltered = this.filterByAge(templates, ageBand);

    if (!ageFiltered.length) {
      throw new WorksheetException(
        'NO_TEMPLATE_FOUND',
        'No active worksheet template matches the request age band',
        HttpStatus.NOT_FOUND,
        {
          grade: request.grade ?? null,
          subject: request.subject ?? null,
          topic: request.topic ?? null,
          ageBand: ageBand ? { min: ageBand.min, max: ageBand.max } : null,
        },
      );
    }

    if (ageFiltered.length === 1) {
      const selected = ageFiltered[0];
      (selected as any)._aiOutcome = {
        usedFallback: true,
        fallbackReason: 'single_candidate',
      };
      this.attachTelemetry(selected, {
        ageBand,
        ageFilteredCount: 1,
        stage2Classification: null,
        rerankTopScores: [{ id: selected.id, slug: selected.slug, score: 0 }],
        scoreMargin: null,
        selectionMode: 'deterministic',
        selectionReason: 'single_age_match',
      });
      return selected;
    }

    // Stage 2 — classify intent, then rerank (scoring signals only; no hard exclude)
    const classification = await this.classifyRequest(request, ageBand, telemetry);
    const ranked = this.rerank(ageFiltered, request, classification);
    const top = ranked[0];
    const second = ranked[1];
    const scoreMargin =
      second != null ? top.score - second.score : Number.POSITIVE_INFINITY;
    const rerankTopScores = ranked.slice(0, TEMPLATE_SELECTION_AI_TOP_N).map((r) => ({
      id: r.template.id,
      slug: r.template.slug,
      score: r.score,
    }));

    // Stage 3 — decisive margin → deterministic; else AI among top N
    if (scoreMargin >= TEMPLATE_SELECTION_MIN_SCORE_MARGIN && top.score > 0) {
      (top.template as any)._aiOutcome = {
        usedFallback: true,
        fallbackReason: 'single_candidate',
      };
      this.attachTelemetry(top.template, {
        ageBand,
        ageFilteredCount: ageFiltered.length,
        stage2Classification: classification,
        rerankTopScores,
        scoreMargin: Number.isFinite(scoreMargin) ? scoreMargin : null,
        selectionMode: 'deterministic',
        selectionReason: 'decisive_rerank_margin',
      });
      return top.template;
    }

    const topN = ranked.slice(0, TEMPLATE_SELECTION_AI_TOP_N).map((r) => r.template);
    const outcome = await this.aiService.select({
      topic: request.topic ?? null,
      query: request.query ?? null,
      ageGroup: request.ageGroup ?? null,
      grade: request.grade ?? null,
      subject: request.subject ?? null,
      difficulty: classification?.difficulty ?? request.difficulty ?? null,
      allowedTemplateIds: topN.map((t) => t.id),
      classification,
      telemetry,
    });

    const selected = this.resolveAiOrFallback(topN, outcome);
    this.attachTelemetry(selected, {
      ageBand,
      ageFilteredCount: ageFiltered.length,
      stage2Classification: classification,
      rerankTopScores,
      scoreMargin: Number.isFinite(scoreMargin) ? scoreMargin : null,
      selectionMode: outcome.usedFallback || !outcome.result ? 'deterministic' : 'ai',
      selectionReason: outcome.usedFallback
        ? `ai_fallback_${outcome.fallbackReason ?? 'unknown'}`
        : 'ai_pick',
    });
    return selected;
  }

  public async listMatching(
    request: GenerateWorksheetRequest,
    limit = 10,
    telemetry?: PipelineTelemetryContext,
  ): Promise<WorksheetTemplateRecord[]> {
    const explicit = request.templateId?.trim();
    if (explicit) {
      return [await this.templateService.getActiveByIdOrSlug(explicit)];
    }

    const ageBand = resolveAgeBand(request);
    const templates = await this.templateService.listActive();
    const ageFiltered = this.filterByAge(templates, ageBand);
    if (!ageFiltered.length) {
      return [];
    }

    const classification = await this.classifyRequest(request, ageBand, telemetry);
    const ranked = this.rerank(ageFiltered, request, classification);
    const topN = ranked.slice(0, Math.max(limit, TEMPLATE_SELECTION_AI_TOP_N));

    if (topN.length > 1) {
      const outcome = await this.aiService.select({
        topic: request.topic ?? null,
        query: request.query ?? null,
        ageGroup: request.ageGroup ?? null,
        grade: request.grade ?? null,
        subject: request.subject ?? null,
        difficulty: classification?.difficulty ?? request.difficulty ?? null,
        allowedTemplateIds: topN
          .slice(0, TEMPLATE_SELECTION_AI_TOP_N)
          .map((r) => r.template.id),
        classification,
        telemetry,
      });

      if (!outcome.usedFallback && outcome.result) {
        const selectedId = outcome.result.selectedTemplateId;
        const alternativeId = outcome.result.alternativeTemplateId;
        const pool = topN.map((r) => r.template);
        if (alternativeId) {
          const altIdx = pool.findIndex((t) => t.id === alternativeId);
          if (altIdx !== -1) {
            const [altTemp] = pool.splice(altIdx, 1);
            pool.unshift(altTemp);
          }
        }
        if (selectedId) {
          const selIdx = pool.findIndex((t) => t.id === selectedId);
          if (selIdx !== -1) {
            const [selTemp] = pool.splice(selIdx, 1);
            pool.unshift(selTemp);
          }
        }
        return pool.slice(0, Math.max(1, limit));
      }
    }

    return topN.slice(0, Math.max(1, limit)).map((r) => r.template);
  }

  /** Stage 1 age hard-filter (public for tests / callers). */
  public isEligible(
    template: WorksheetTemplateRecord,
    request: GenerateWorksheetRequest,
  ): boolean {
    if (template.status !== 'ACTIVE') {
      return false;
    }
    return this.passesAgeHardFilter(template, resolveAgeBand(request));
  }

  /** Set listing uses the same Stage 1 age hard-filter. */
  public isEligibleForSet(
    template: WorksheetTemplateRecord,
    request: GenerateWorksheetRequest,
  ): boolean {
    return this.isEligible(template, request);
  }

  /**
   * Stage 2 rerank score (public for tests).
   * Without classification, only subject/grade/difficulty request fields score.
   */
  public score(
    template: WorksheetTemplateRecord,
    request: GenerateWorksheetRequest,
    classification?: WorksheetTemplateIntentClassification | null,
  ): number {
    const meta = this.templateService.parseMeta(template);
    let score = 0;

    if (this.matchesThemeOrSubTopic(meta, classification, request.topic)) {
      score += 12;
    }
    if (
      classification?.activityIntent &&
      this.matchesActivity(meta.activityType, classification.activityIntent)
    ) {
      score += 10;
    } else if (
      this.matchesActivityIdentity(template, request, classification)
    ) {
      // Many DB templates omit meta.activityType — still honor query/intent vs name/slug.
      score += 10;
    }
    if (request.subject && this.includesInsensitive(meta.subjects, request.subject)) {
      score += 8;
    }
    if (request.grade && this.includesInsensitive(meta.grades, request.grade)) {
      score += 6;
    }

    const difficulty =
      classification?.difficulty ?? request.difficulty ?? null;
    if (difficulty && this.includesInsensitive(meta.difficulty, difficulty)) {
      score += 4;
    }

    if (this.matchesSelectionProfileTopics(template, request)) {
      score += 6;
    }

    return score;
  }

  /**
   * Fuzzy overlap between request query/topic and selectionProfile canBeUsedFor / exampleTopics.
   */
  public matchesSelectionProfileTopics(
    template: WorksheetTemplateRecord,
    request: GenerateWorksheetRequest,
  ): boolean {
    const profile = template.selectionProfile;
    if (!profile) {
      return false;
    }
    const haystack = [
      ...(profile.canBeUsedFor ?? []),
      ...(profile.exampleTopics ?? []),
    ];
    if (!haystack.length) {
      return false;
    }
    const needles = [request.query, request.topic]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim().toLowerCase());
    if (!needles.length) {
      return false;
    }

    return haystack.some((entry) => {
      const phrase = entry.trim().toLowerCase();
      if (!phrase) return false;
      return needles.some(
        (needle) =>
          needle.includes(phrase) ||
          phrase.includes(needle) ||
          this.keywordOverlap(needle, phrase),
      );
    });
  }

  /**
   * When meta.activityType is missing, match activity from classification intent
   * and/or query phrasing against template name / slug (e.g. "match the pairs of planets").
   */
  public matchesActivityIdentity(
    template: WorksheetTemplateRecord,
    request: GenerateWorksheetRequest,
    classification?: WorksheetTemplateIntentClassification | null,
  ): boolean {
    const name = (template.name ?? '').trim().toLowerCase();
    const slugPhrase = template.slug.replace(/_/g, ' ').trim().toLowerCase();
    const intent = classification?.activityIntent?.trim().toLowerCase() ?? '';

    if (intent) {
      if (name === intent || slugPhrase === intent) {
        return true;
      }
      // Require 2+ shared tokens so "Match the Pairs" does not boost
      // "Matching Single Letter" on the lone token "match".
      const intentTokens = this.tokenizeForOverlap(intent);
      const identityTokens = this.tokenizeForOverlap(
        [name, slugPhrase].filter(Boolean).join(' '),
      );
      const shared = [...intentTokens].filter((t) => identityTokens.has(t));
      if (shared.length >= 2) {
        return true;
      }
    }

    const requestText = [request.query, request.topic]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .join(' ')
      .toLowerCase();
    if (!requestText) {
      return false;
    }

    const slugTokens = template.slug
      .split('_')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 2 && !ACTIVITY_IDENTITY_STOPWORDS.has(t));
    if (!slugTokens.length) {
      return false;
    }

    const requestTokens = this.tokenizeForOverlap(requestText);
    const hits = slugTokens.filter((token) =>
      requestTokens.has(this.stemToken(token)),
    );
    // Require 2+ slug tokens in the query (e.g. "match" + "pairs") to avoid
    // boosting match_the_pairs on any query that merely says "match".
    return hits.length >= 2;
  }

  private keywordOverlap(a: string, b: string): boolean {
    const tokensA = this.tokenizeForOverlap(a);
    const tokensB = this.tokenizeForOverlap(b);
    if (!tokensA.size || !tokensB.size) {
      return false;
    }
    for (const t of tokensA) {
      if (tokensB.has(t)) {
        return true;
      }
    }
    return false;
  }

  private tokenizeForOverlap(text: string): Set<string> {
    return new Set(
      text
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 3)
        .map((t) => this.stemToken(t)),
    );
  }

  /** Cheap English stem so "planets"↔"planet", "matching"↔"match". */
  private stemToken(token: string): string {
    if (token.length > 5 && token.endsWith('ing')) {
      return token.slice(0, -3);
    }
    if (token.length > 4 && token.endsWith('ies')) {
      return `${token.slice(0, -3)}y`;
    }
    if (token.length > 4 && token.endsWith('ses')) {
      return token.slice(0, -2);
    }
    if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) {
      return token.slice(0, -1);
    }
    return token;
  }
  private filterByAge(
    templates: WorksheetTemplateRecord[],
    ageBand: AgeBand | null,
  ): WorksheetTemplateRecord[] {
    return templates.filter((template) => {
      if (this.isExplicitOnlyTemplate(template)) {
        return false;
      }
      return this.passesAgeHardFilter(template, ageBand);
    });
  }

  private isExplicitOnlyTemplate(template: WorksheetTemplateRecord): boolean {
    const meta = this.templateService.parseMeta(template);
    return String(meta.selectionMode ?? '').toLowerCase() === 'explicit_only';
  }

  private passesAgeHardFilter(
    template: WorksheetTemplateRecord,
    ageBand: AgeBand | null,
  ): boolean {
    if (template.status !== 'ACTIVE') {
      return false;
    }
    const meta = this.templateService.parseMeta(template);
    const templateAge = readTemplateAgeRange(meta);
    if (!templateAge) {
      this.logger.warn(
        `TEMPLATE_MISSING_AGE_META slug=${template.slug} id=${template.id}`,
      );
      return false;
    }
    if (!ageBand) {
      // No resolvable request age — keep templates that declare age meta.
      return true;
    }
    return ageBandsOverlap(templateAge.min, templateAge.max, ageBand.min, ageBand.max);
  }

  private async classifyRequest(
    request: GenerateWorksheetRequest,
    ageBand: AgeBand | null,
    telemetry?: PipelineTelemetryContext,
  ): Promise<WorksheetTemplateIntentClassification | null> {
    const taxonomy =
      ageBand != null ? taxonomyForAgeBand(ageBand.min, ageBand.max) : null;
    const useClosedTaxonomy = taxonomy != null;

    try {
      return await this.aiService.classify({
        query: request.query ?? null,
        topic: request.topic ?? null,
        difficulty: request.difficulty ?? null,
        ageBand: ageBand ? { min: ageBand.min, max: ageBand.max } : null,
        useClosedTaxonomy,
        themes: taxonomy ? flattenTaxonomyThemes(taxonomy) : [],
        subTopics: taxonomy ? flattenTaxonomySubTopics(taxonomy) : [],
        activityTypes: [...WORKSHEET_ACTIVITY_TYPES],
        telemetry,
      });
    } catch (error) {
      this.logger.warn(
        `Stage 2 classification failed; continuing with empty classification: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.fallbackClassification(request);
    }
  }

  private fallbackClassification(
    request: GenerateWorksheetRequest,
  ): WorksheetTemplateIntentClassification {
    const raw = request.difficulty?.trim().toLowerCase();
    const difficulty =
      raw === 'easy' || raw === 'medium' || raw === 'hard' ? raw : null;
    return {
      theme: null,
      subTopic: request.topic?.trim() || null,
      activityIntent: null,
      difficulty,
      confidence: 0,
    };
  }

  private rerank(
    templates: WorksheetTemplateRecord[],
    request: GenerateWorksheetRequest,
    classification: WorksheetTemplateIntentClassification | null,
  ): Array<{ template: WorksheetTemplateRecord; score: number }> {
    const ranked = templates.map((template) => ({
      template,
      score: this.score(template, request, classification),
    }));
    ranked.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const byUpdated =
        b.template.updatedAt.getTime() - a.template.updatedAt.getTime();
      if (byUpdated !== 0) {
        return byUpdated;
      }
      return a.template.id.localeCompare(b.template.id);
    });
    return ranked;
  }

  private resolveAiOrFallback(
    topN: WorksheetTemplateRecord[],
    outcome: WorksheetTemplateSelectionAiOutcome,
  ): WorksheetTemplateRecord {
    if (!outcome.usedFallback && outcome.result) {
      const aiSelected = topN.find(
        (t) => t.id === outcome.result!.selectedTemplateId,
      );
      if (aiSelected) {
        (aiSelected as any)._aiOutcome = outcome;
        return aiSelected;
      }
    }
    (topN[0] as any)._aiOutcome = outcome;
    return topN[0];
  }

  private matchesThemeOrSubTopic(
    meta: WorksheetTemplateMeta,
    classification: WorksheetTemplateIntentClassification | null | undefined,
    requestTopic?: string,
  ): boolean {
    if (classification?.theme) {
      if (
        this.equalsInsensitive(meta.theme, classification.theme) ||
        this.includesInsensitive(meta.topics, classification.theme)
      ) {
        return true;
      }
    }
    if (classification?.subTopic) {
      if (
        this.includesInsensitive(meta.subTopics, classification.subTopic) ||
        this.includesInsensitive(meta.topics, classification.subTopic)
      ) {
        return true;
      }
    }
    if (requestTopic?.trim()) {
      if (
        this.includesInsensitive(meta.topics, requestTopic) ||
        this.includesInsensitive(meta.subTopics, requestTopic) ||
        this.equalsInsensitive(meta.theme, requestTopic)
      ) {
        return true;
      }
    }
    return false;
  }

  private matchesActivity(
    activityTypes: string[] | undefined,
    intent: string,
  ): boolean {
    if (!activityTypes?.length) {
      return false;
    }
    const needle = intent.trim().toLowerCase();
    return activityTypes.some((value) => {
      const hay = value.trim().toLowerCase();
      return hay === needle || hay.includes(needle) || needle.includes(hay);
    });
  }

  private includesInsensitive(
    values: string[] | undefined,
    candidate: string,
  ): boolean {
    if (!values?.length) {
      return false;
    }
    const needle = candidate.trim().toLowerCase();
    return values.some((value) => value.trim().toLowerCase() === needle);
  }

  private equalsInsensitive(
    value: string | undefined,
    candidate: string,
  ): boolean {
    if (!value?.trim()) {
      return false;
    }
    return value.trim().toLowerCase() === candidate.trim().toLowerCase();
  }

  private attachTelemetry(
    template: WorksheetTemplateRecord,
    telemetry: WorksheetTemplateSelectionTelemetry,
  ): void {
    (template as any)._selectionTelemetry = {
      ...telemetry,
      ageBand: telemetry.ageBand
        ? {
            min: telemetry.ageBand.min,
            max: telemetry.ageBand.max,
            source: telemetry.ageBand.source,
          }
        : null,
    } satisfies WorksheetTemplateSelectionTelemetry;
  }
}

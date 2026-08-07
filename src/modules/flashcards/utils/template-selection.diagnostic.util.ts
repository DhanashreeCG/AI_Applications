import {
  ALL_RULE_SEEDS,
  TEMPLATE_SEEDS,
} from '../services/flashcard-seed.service';
import {
  RankedTemplateCandidate,
  SelectableRule,
  rankTemplateCandidates,
  selectBestTemplate,
} from './template-selection.engine';
import {
  LearningObjective,
} from '../constants/flashcard.constants';
import {
  ObjectiveConfidence,
  resolveUserRequest,
} from './user-request.resolver';

export interface DiagnosticCaseInput {
  label: string;
  query: string;
  ageGroup: string;
  expectedObjective: LearningObjective;
  expectedObjectiveConfidence?: ObjectiveConfidence;
  expectedTemplateId: string;
}

export interface CandidateBreakdownRow {
  rank: number;
  templateId: string;
  ruleId: string;
  ruleName: string;
  totalScore: number;
  templateVersion: string;
  rulePriority: number;
  rawObjectiveRank: number;
  effectiveObjectiveRank: number;
  exactAge: boolean;
  exactGrade: boolean;
  exactSubject: boolean;
  exactDifficulty: boolean;
  exactObjective: boolean;
  scoreComponents: RankedTemplateCandidate['breakdown']['scoreComponents'];
}

export interface DiagnosticCaseResult {
  label: string;
  query: string;
  ageGroup: string;
  resolved: {
    topic: string;
    learningObjective: LearningObjective;
    objectiveConfidence: ObjectiveConfidence;
    grade: string | null;
    subject: string | null;
    difficulty: string;
  };
  expectedTemplateId: string;
  selectedTemplateId: string | null;
  selectedRuleId: string | null;
  totalScoreGap: number | null;
  objectiveTierGap: number | null;
  fragilePass: boolean;
  fragileReason: string | null;
  candidates: CandidateBreakdownRow[];
}

function templateSeedToSelectable(
  template: (typeof TEMPLATE_SEEDS)[number],
  rules: typeof ALL_RULE_SEEDS,
): SelectableRule[] {
  const templateRules = rules.filter((rule) => rule.templateId === template.id);
  const ageParts = template.supportedAgeGroups.flatMap((group) =>
    group.split('-').map(Number),
  );
  const templateAgeMin = ageParts.length ? Math.min(...ageParts) : 0;
  const templateAgeMax = ageParts.length ? Math.max(...ageParts) : 99;

  const buildRule = (
    rule: (typeof ALL_RULE_SEEDS)[number] | null,
  ): SelectableRule => ({
    id: rule?.id ?? `synthetic-${template.id}`,
    name: rule?.name ?? `Template metadata: ${template.name}`,
    priority: rule?.priority ?? 50,
    ageMin: rule?.ageMin ?? null,
    ageMax: rule?.ageMax ?? null,
    grades: [],
    subjects: [],
    learningObjectives: rule?.learningObjectives ?? [],
    difficulties: [],
    intents: [],
    topics: [],
    templateId: template.id,
    templateActive: true,
    templateAgeGroups: template.supportedAgeGroups,
    templateAgeMin,
    templateAgeMax,
    templateSubjects: template.subjectsSupported,
    templateObjectives: template.learningObjectives,
    templateDifficulties: template.difficultyLevels,
    templateVersion: '1.0',
  });

  if (!templateRules.length) {
    return [buildRule(null)];
  }

  return templateRules.map((rule) => buildRule(rule));
}

export function buildSeedCatalog(): SelectableRule[] {
  return TEMPLATE_SEEDS.flatMap((template) =>
    templateSeedToSelectable(template, ALL_RULE_SEEDS),
  );
}

function toCandidateRow(
  candidate: RankedTemplateCandidate,
  rank: number,
): CandidateBreakdownRow {
  return {
    rank,
    templateId: candidate.templateId,
    ruleId: candidate.ruleId,
    ruleName: candidate.ruleName,
    totalScore: candidate.score,
    templateVersion: candidate.templateVersion,
    rulePriority: candidate.priority,
    rawObjectiveRank: candidate.breakdown.objectiveRank,
    effectiveObjectiveRank: candidate.breakdown.effectiveObjectiveRank,
    exactAge: candidate.breakdown.exactAge,
    exactGrade: candidate.breakdown.exactGrade,
    exactSubject: candidate.breakdown.exactSubject,
    exactDifficulty: candidate.breakdown.exactDifficulty,
    exactObjective: candidate.breakdown.exactObjective,
    scoreComponents: candidate.breakdown.scoreComponents,
  };
}

export function runDiagnosticCase(
  testCase: DiagnosticCaseInput,
  rules: SelectableRule[],
): DiagnosticCaseResult {
  const resolved = resolveUserRequest({
    query: testCase.query,
    ageGroup: testCase.ageGroup,
  });

  const ranked = rankTemplateCandidates(rules, {
    learningObjective: resolved.learningObjective,
    ageMin: resolved.ageMin,
    ageMax: resolved.ageMax,
    ageGroup: resolved.ageGroup,
    objectiveConfidence: resolved.objectiveConfidence,
    grade: resolved.grade ?? undefined,
    subject: resolved.subject ?? undefined,
    difficulty: resolved.difficulty,
  });

  const selected = selectBestTemplate(rules, {
    learningObjective: resolved.learningObjective,
    ageMin: resolved.ageMin,
    ageMax: resolved.ageMax,
    ageGroup: resolved.ageGroup,
    objectiveConfidence: resolved.objectiveConfidence,
    grade: resolved.grade ?? undefined,
    subject: resolved.subject ?? undefined,
    difficulty: resolved.difficulty,
  });

  const totalScoreGap =
    ranked.length >= 2 ? ranked[0].score - ranked[1].score : null;
  const objectiveTierGap =
    ranked.length >= 2
      ? ranked[0].breakdown.effectiveObjectiveRank -
        ranked[1].breakdown.effectiveObjectiveRank
      : null;

  const fragilePass =
    ranked.length >= 2 &&
    objectiveTierGap !== null &&
    objectiveTierGap < 1 &&
    selected?.templateId === testCase.expectedTemplateId;

  const fragileReason =
    fragilePass && ranked.length >= 2
      ? `#1 (${ranked[0].ruleId}) and #2 (${ranked[1].ruleId}) share effectiveObjectiveRank=${ranked[0].breakdown.effectiveObjectiveRank}; winner decided by downstream tie-breakers`
      : null;

  return {
    label: testCase.label,
    query: testCase.query,
    ageGroup: testCase.ageGroup,
    resolved: {
      topic: resolved.topic,
      learningObjective: resolved.learningObjective,
      objectiveConfidence: resolved.objectiveConfidence,
      grade: resolved.grade,
      subject: resolved.subject,
      difficulty: resolved.difficulty,
    },
    expectedTemplateId: testCase.expectedTemplateId,
    selectedTemplateId: selected?.templateId ?? null,
    selectedRuleId: selected?.ruleId ?? null,
    totalScoreGap,
    objectiveTierGap,
    fragilePass,
    fragileReason,
    candidates: ranked.map((candidate, index) =>
      toCandidateRow(candidate, index + 1),
    ),
  };
}

export function formatCandidateTable(candidates: CandidateBreakdownRow[]): string {
  if (!candidates.length) {
    return '_No eligible candidates after hard filters._';
  }

  const lines = [
    '| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |',
    '|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|',
  ];

  for (const row of candidates) {
    lines.push(
      `| ${row.rank} | \`${row.templateId}\` | \`${row.ruleId}\` | ${row.totalScore} | ${row.effectiveObjectiveRank} (raw ${row.rawObjectiveRank}) | ${row.exactAge ? 'Y' : 'n'} | ${row.exactGrade ? 'Y' : 'n'} | ${row.exactSubject ? 'Y' : 'n'} | ${row.exactDifficulty ? 'Y' : 'n'} | ${row.templateVersion} | ${row.rulePriority} |`,
    );
  }

  return lines.join('\n');
}

export function formatScoreComponents(row: CandidateBreakdownRow): string {
  const parts = row.scoreComponents;
  return [
    `objectiveRank=${parts.objectiveRank}`,
    `exactAge=${parts.exactAge}`,
    `exactGrade=${parts.exactGrade}`,
    `exactSubject=${parts.exactSubject}`,
    `exactDifficulty=${parts.exactDifficulty}`,
    `rulePriority=${parts.rulePriority}`,
    `objectiveExactBoost=${parts.objectiveExactBoost}`,
  ].join(', ');
}

export function formatDiagnosticReportMarkdown(
  results: DiagnosticCaseResult[],
): string {
  const fragile = results.filter((result) => result.fragilePass);
  const lines: string[] = [
    `# Template Selection Ranking Breakdown (${results.length} diagnostic cases)`,
    '',
    'Generated from `template-selection.diagnostic.util.ts` against the seed catalog (`TEMPLATE_SEEDS` + `ALL_RULE_SEEDS`).',
    '',
    '**Fragile pass definition:** top two candidates share the same `effectiveObjectiveRank` (objective-tier gap `< 1`), so the winner relies on age/grade/subject/difficulty/version/priority/rule-id tie-breakers even when the selected template matches expectations.',
    '',
    `**Fragile passes in this catalog:** ${fragile.length}`,
  ];

  if (fragile.length) {
    lines.push('');
    for (const result of fragile) {
      lines.push(
        `- **${result.label}** — ${result.fragileReason}; total score gap=${result.totalScoreGap}`,
      );
    }
  } else {
    lines.push('');
    lines.push('_None — every case separates #1 and #2 by at least one objective tier._');
  }

  lines.push('', '---', '');

  for (const result of results) {
    lines.push(`## ${result.label}`);
    lines.push('');
    lines.push(`- **Query:** \`${result.query}\``);
    lines.push(`- **Age group:** ${result.ageGroup}`);
    lines.push(
      `- **Resolved:** objective=\`${result.resolved.learningObjective}\`, confidence=\`${result.resolved.objectiveConfidence}\`, topic=\`${result.resolved.topic}\``,
    );
    lines.push(
      `- **Winner:** \`${result.selectedTemplateId}\` via rule \`${result.selectedRuleId}\` (expected \`${result.expectedTemplateId}\`)`,
    );
    lines.push(
      `- **Gaps:** total score #1−#2=${result.totalScoreGap ?? 'n/a'}, objective tier #1−#2=${result.objectiveTierGap ?? 'n/a'}${result.fragilePass ? ' **FRAGILE**' : ''}`,
    );
    lines.push('');
    lines.push(formatCandidateTable(result.candidates));
    lines.push('');
    lines.push('<details><summary>Score component detail (all candidates)</summary>');
    lines.push('');
    for (const row of result.candidates) {
      lines.push(`- **#${row.rank} \`${row.ruleId}\`:** ${formatScoreComponents(row)}`);
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  return lines.join('\n');
}

export function collectDiagnosticResults(
  cases: DiagnosticCaseInput[],
  rules: SelectableRule[] = buildSeedCatalog(),
): DiagnosticCaseResult[] {
  return cases.map((testCase) => runDiagnosticCase(testCase, rules));
}

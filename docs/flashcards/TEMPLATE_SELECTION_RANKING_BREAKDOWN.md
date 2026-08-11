# Template Selection Ranking Breakdown (23 diagnostic cases)

Generated from `template-selection.diagnostic.util.ts` against the seed catalog (`TEMPLATE_SEEDS` + `ALL_RULE_SEEDS`).

**Fragile pass definition:** top two candidates share the same `effectiveObjectiveRank` (objective-tier gap `< 1`), so the winner relies on age/grade/subject/difficulty/version/priority/rule-id tie-breakers even when the selected template matches expectations.

**Fragile passes in this catalog:** 12

- **no keyword age default vocabulary** — #1 (rule_age_3_4_vocabulary) and #2 (rule_age_2_3_recognition) share effectiveObjectiveRank=2; winner decided by downstream tie-breakers; total score gap=500
- **about noise word does not hijack objective** — #1 (rule_age_3_4_vocabulary) and #2 (rule_age_2_3_recognition) share effectiveObjectiveRank=2; winner decided by downstream tie-breakers; total score gap=500
- **quiz keyword** — #1 (rule_age_6_8_qa) and #2 (rule_age_8_plus_quiz) share effectiveObjectiveRank=3; winner decided by downstream tie-breakers; total score gap=500
- **recognition age default 2-3** — #1 (rule_age_2_3_recognition) and #2 (rule_age_3_4_vocabulary) share effectiveObjectiveRank=2; winner decided by downstream tie-breakers; total score gap=500
- **match pairs** — #1 (rule_obj_3_4_comparison) and #2 (rule_obj_3_4_counting) share effectiveObjectiveRank=3; winner decided by downstream tie-breakers; total score gap=0
- **classify categories** — #1 (rule_obj_5_6_comparison) and #2 (rule_obj_6_8_comparison) share effectiveObjectiveRank=3; winner decided by downstream tie-breakers; total score gap=600
- **reading story** — #1 (rule_obj_6_8_comparison) and #2 (rule_age_6_8_qa) share effectiveObjectiveRank=3; winner decided by downstream tie-breakers; total score gap=10
- **difference comparison phrasing** — #1 (rule_obj_5_6_comparison) and #2 (rule_obj_6_8_comparison) share effectiveObjectiveRank=3; winner decided by downstream tie-breakers; total score gap=600
- **spot recognition** — #1 (rule_age_2_3_recognition) and #2 (rule_age_3_4_vocabulary) share effectiveObjectiveRank=3; winner decided by downstream tie-breakers; total score gap=500
- **grade 1 vegetables EVS** — #1 (rule_obj_5_6_counting) and #2 (rule_age_5_6_facts) share effectiveObjectiveRank=2; winner decided by downstream tie-breakers; total score gap=10
- **vs comparison shorthand** — #1 (rule_obj_6_8_comparison) and #2 (rule_obj_5_6_comparison) share effectiveObjectiveRank=3; winner decided by downstream tie-breakers; total score gap=500
- **reading in range phrasing** — #1 (rule_obj_6_8_comparison) and #2 (rule_age_6_8_qa) share effectiveObjectiveRank=3; winner decided by downstream tie-breakers; total score gap=10

---

## compare keyword

- **Query:** `Compare fruits`
- **Age group:** 3-4
- **Resolved:** objective=`comparison`, confidence=`exact_keyword`, topic=`Compare fruits`
- **Winner:** `tmpl_image_word_sentence` via rule `rule_obj_3_4_comparison` (expected `tmpl_image_word_sentence`)
- **Gaps:** total score #1−#2=1160, objective tier #1−#2=1

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_image_word_sentence` | `rule_obj_3_4_comparison` | 3830 | 3 (raw 3) | Y | n | n | Y | 1.0 | 110 |
| 2 | `tmpl_image_word_sentence` | `rule_obj_3_4_counting` | 2670 | 2 (raw 2) | Y | n | n | Y | 1.0 | 110 |
| 3 | `tmpl_image_word_sentence` | `rule_obj_3_4_sorting` | 2670 | 2 (raw 2) | Y | n | n | Y | 1.0 | 110 |
| 4 | `tmpl_image_word_sentence` | `rule_age_3_4_vocabulary` | 2660 | 2 (raw 2) | Y | n | n | Y | 1.0 | 100 |
| 5 | `tmpl_large_image_word` | `rule_age_2_3_recognition` | 2160 | 2 (raw 2) | n | n | n | Y | 1.0 | 100 |
| 6 | `tmpl_image_word_sentence` | `rule_obj_3_4_phonics` | 670 | 0 (raw 0) | Y | n | n | Y | 1.0 | 110 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_obj_3_4_comparison`:** objectiveRank=3000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=120
- **#2 `rule_obj_3_4_counting`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#3 `rule_obj_3_4_sorting`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#4 `rule_age_3_4_vocabulary`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#5 `rule_age_2_3_recognition`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#6 `rule_obj_3_4_phonics`:** objectiveRank=0, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40

</details>

## sort keyword

- **Query:** `Sort vegetables by color`
- **Age group:** 5-6
- **Resolved:** objective=`sorting`, confidence=`exact_keyword`, topic=`Sort vegetables by color`
- **Winner:** `tmpl_image_word_fact` via rule `rule_obj_5_6_comparison` (expected `tmpl_image_word_fact`)
- **Gaps:** total score #1−#2=1160, objective tier #1−#2=1

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_image_word_fact` | `rule_obj_5_6_comparison` | 3830 | 3 (raw 3) | Y | n | n | Y | 1.0 | 110 |
| 2 | `tmpl_image_word_fact` | `rule_obj_5_6_counting` | 2670 | 2 (raw 2) | Y | n | n | Y | 1.0 | 110 |
| 3 | `tmpl_image_description_question` | `rule_obj_6_8_comparison` | 2070 | 2 (raw 2) | n | n | n | n | 1.0 | 110 |
| 4 | `tmpl_image_description_question` | `rule_age_6_8_qa` | 2060 | 2 (raw 2) | n | n | n | n | 1.0 | 100 |
| 5 | `tmpl_image_word_fact` | `rule_age_5_6_facts` | 1660 | 1 (raw 1) | Y | n | n | Y | 1.0 | 100 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_obj_5_6_comparison`:** objectiveRank=3000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=120
- **#2 `rule_obj_5_6_counting`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#3 `rule_obj_6_8_comparison`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=0, rulePriority=110, objectiveExactBoost=-40
- **#4 `rule_age_6_8_qa`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=0, rulePriority=100, objectiveExactBoost=-40
- **#5 `rule_age_5_6_facts`:** objectiveRank=1000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40

</details>

## phonics sound query

- **Query:** `What sound does A make?`
- **Age group:** 3-4
- **Resolved:** objective=`phonics`, confidence=`exact_keyword`, topic=`What sound does`
- **Winner:** `tmpl_image_word_sentence` via rule `rule_obj_3_4_phonics` (expected `tmpl_image_word_sentence`)
- **Gaps:** total score #1−#2=1170, objective tier #1−#2=1

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_image_word_sentence` | `rule_obj_3_4_phonics` | 3830 | 3 (raw 3) | Y | n | n | Y | 1.0 | 110 |
| 2 | `tmpl_image_word_sentence` | `rule_age_3_4_vocabulary` | 2660 | 2 (raw 2) | Y | n | n | Y | 1.0 | 100 |
| 3 | `tmpl_large_image_word` | `rule_age_2_3_recognition` | 2160 | 2 (raw 2) | n | n | n | Y | 1.0 | 100 |
| 4 | `tmpl_image_word_sentence` | `rule_obj_3_4_comparison` | 670 | 0 (raw 0) | Y | n | n | Y | 1.0 | 110 |
| 5 | `tmpl_image_word_sentence` | `rule_obj_3_4_counting` | 670 | 0 (raw 0) | Y | n | n | Y | 1.0 | 110 |
| 6 | `tmpl_image_word_sentence` | `rule_obj_3_4_sorting` | 670 | 0 (raw 0) | Y | n | n | Y | 1.0 | 110 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_obj_3_4_phonics`:** objectiveRank=3000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=120
- **#2 `rule_age_3_4_vocabulary`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#3 `rule_age_2_3_recognition`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#4 `rule_obj_3_4_comparison`:** objectiveRank=0, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#5 `rule_obj_3_4_counting`:** objectiveRank=0, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#6 `rule_obj_3_4_sorting`:** objectiveRank=0, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40

</details>

## no keyword age default vocabulary

- **Query:** `Generate flashcards on vegetables`
- **Age group:** 3-4
- **Resolved:** objective=`vocabulary`, confidence=`age_default`, topic=`vegetables`
- **Winner:** `tmpl_image_word_sentence` via rule `rule_age_3_4_vocabulary` (expected `tmpl_image_word_sentence`)
- **Gaps:** total score #1−#2=500, objective tier #1−#2=0 **FRAGILE**

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_image_word_sentence` | `rule_age_3_4_vocabulary` | 2820 | 2 (raw 3) | Y | n | n | Y | 1.0 | 100 |
| 2 | `tmpl_large_image_word` | `rule_age_2_3_recognition` | 2320 | 2 (raw 3) | n | n | n | Y | 1.0 | 100 |
| 3 | `tmpl_image_word_sentence` | `rule_obj_3_4_phonics` | 2670 | 2 (raw 2) | Y | n | n | Y | 1.0 | 110 |
| 4 | `tmpl_image_word_sentence` | `rule_obj_3_4_comparison` | 670 | 0 (raw 0) | Y | n | n | Y | 1.0 | 110 |
| 5 | `tmpl_image_word_sentence` | `rule_obj_3_4_counting` | 670 | 0 (raw 0) | Y | n | n | Y | 1.0 | 110 |
| 6 | `tmpl_image_word_sentence` | `rule_obj_3_4_sorting` | 670 | 0 (raw 0) | Y | n | n | Y | 1.0 | 110 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_age_3_4_vocabulary`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=120
- **#2 `rule_age_2_3_recognition`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=120
- **#3 `rule_obj_3_4_phonics`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#4 `rule_obj_3_4_comparison`:** objectiveRank=0, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#5 `rule_obj_3_4_counting`:** objectiveRank=0, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#6 `rule_obj_3_4_sorting`:** objectiveRank=0, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40

</details>

## about noise word does not hijack objective

- **Query:** `Flashcards about animals`
- **Age group:** 3-4
- **Resolved:** objective=`vocabulary`, confidence=`age_default`, topic=`animals`
- **Winner:** `tmpl_image_word_sentence` via rule `rule_age_3_4_vocabulary` (expected `tmpl_image_word_sentence`)
- **Gaps:** total score #1−#2=500, objective tier #1−#2=0 **FRAGILE**

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_image_word_sentence` | `rule_age_3_4_vocabulary` | 2820 | 2 (raw 3) | Y | n | n | Y | 1.0 | 100 |
| 2 | `tmpl_large_image_word` | `rule_age_2_3_recognition` | 2320 | 2 (raw 3) | n | n | n | Y | 1.0 | 100 |
| 3 | `tmpl_image_word_sentence` | `rule_obj_3_4_phonics` | 2670 | 2 (raw 2) | Y | n | n | Y | 1.0 | 110 |
| 4 | `tmpl_image_word_sentence` | `rule_obj_3_4_comparison` | 670 | 0 (raw 0) | Y | n | n | Y | 1.0 | 110 |
| 5 | `tmpl_image_word_sentence` | `rule_obj_3_4_counting` | 670 | 0 (raw 0) | Y | n | n | Y | 1.0 | 110 |
| 6 | `tmpl_image_word_sentence` | `rule_obj_3_4_sorting` | 670 | 0 (raw 0) | Y | n | n | Y | 1.0 | 110 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_age_3_4_vocabulary`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=120
- **#2 `rule_age_2_3_recognition`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=120
- **#3 `rule_obj_3_4_phonics`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#4 `rule_obj_3_4_comparison`:** objectiveRank=0, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#5 `rule_obj_3_4_counting`:** objectiveRank=0, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#6 `rule_obj_3_4_sorting`:** objectiveRank=0, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40

</details>

## multi-keyword identify and count

- **Query:** `Identify and count the animals`
- **Age group:** 3-4
- **Resolved:** objective=`counting`, confidence=`exact_keyword`, topic=`Identify and count animals`
- **Winner:** `tmpl_image_word_sentence` via rule `rule_obj_3_4_counting` (expected `tmpl_image_word_sentence`)
- **Gaps:** total score #1−#2=1160, objective tier #1−#2=1

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_image_word_sentence` | `rule_obj_3_4_counting` | 3830 | 3 (raw 3) | Y | n | n | Y | 1.0 | 110 |
| 2 | `tmpl_image_word_sentence` | `rule_obj_3_4_comparison` | 2670 | 2 (raw 2) | Y | n | n | Y | 1.0 | 110 |
| 3 | `tmpl_image_word_sentence` | `rule_obj_3_4_sorting` | 2670 | 2 (raw 2) | Y | n | n | Y | 1.0 | 110 |
| 4 | `tmpl_image_word_sentence` | `rule_age_3_4_vocabulary` | 2660 | 2 (raw 2) | Y | n | n | Y | 1.0 | 100 |
| 5 | `tmpl_large_image_word` | `rule_age_2_3_recognition` | 2160 | 2 (raw 2) | n | n | n | Y | 1.0 | 100 |
| 6 | `tmpl_image_word_sentence` | `rule_obj_3_4_phonics` | 670 | 0 (raw 0) | Y | n | n | Y | 1.0 | 110 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_obj_3_4_counting`:** objectiveRank=3000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=120
- **#2 `rule_obj_3_4_comparison`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#3 `rule_obj_3_4_sorting`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#4 `rule_age_3_4_vocabulary`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#5 `rule_age_2_3_recognition`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#6 `rule_obj_3_4_phonics`:** objectiveRank=0, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40

</details>

## quiz keyword

- **Query:** `Make a quiz about animals`
- **Age group:** 6-8
- **Resolved:** objective=`question_answer`, confidence=`exact_keyword`, topic=`quiz animals`
- **Winner:** `tmpl_image_description_question` via rule `rule_age_6_8_qa` (expected `tmpl_image_description_question`)
- **Gaps:** total score #1−#2=500, objective tier #1−#2=0 **FRAGILE**

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_image_description_question` | `rule_age_6_8_qa` | 3820 | 3 (raw 3) | Y | n | n | Y | 1.0 | 100 |
| 2 | `tmpl_image_fact_quiz` | `rule_age_8_plus_quiz` | 3320 | 3 (raw 3) | n | n | n | Y | 1.0 | 100 |
| 3 | `tmpl_image_description_question` | `rule_obj_6_8_comparison` | 2670 | 2 (raw 2) | Y | n | n | Y | 1.0 | 110 |
| 4 | `tmpl_image_word_fact` | `rule_age_5_6_facts` | 2160 | 2 (raw 2) | n | n | n | Y | 1.0 | 100 |
| 5 | `tmpl_image_word_fact` | `rule_obj_5_6_counting` | 1170 | 1 (raw 1) | n | n | n | Y | 1.0 | 110 |
| 6 | `tmpl_image_word_fact` | `rule_obj_5_6_comparison` | 170 | 0 (raw 0) | n | n | n | Y | 1.0 | 110 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_age_6_8_qa`:** objectiveRank=3000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=120
- **#2 `rule_age_8_plus_quiz`:** objectiveRank=3000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=120
- **#3 `rule_obj_6_8_comparison`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#4 `rule_age_5_6_facts`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#5 `rule_obj_5_6_counting`:** objectiveRank=1000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#6 `rule_obj_5_6_comparison`:** objectiveRank=0, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40

</details>

## science facts

- **Query:** `Science facts about planets`
- **Age group:** 5-6
- **Resolved:** objective=`science_facts`, confidence=`exact_keyword`, topic=`facts planets`
- **Winner:** `tmpl_image_word_fact` via rule `rule_age_5_6_facts` (expected `tmpl_image_word_fact`)
- **Gaps:** total score #1−#2=1150, objective tier #1−#2=1

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_image_word_fact` | `rule_age_5_6_facts` | 4020 | 3 (raw 3) | Y | n | Y | Y | 1.0 | 100 |
| 2 | `tmpl_image_word_fact` | `rule_obj_5_6_counting` | 2870 | 2 (raw 2) | Y | n | Y | Y | 1.0 | 110 |
| 3 | `tmpl_image_description_question` | `rule_age_6_8_qa` | 2060 | 2 (raw 2) | n | n | n | n | 1.0 | 100 |
| 4 | `tmpl_image_word_fact` | `rule_obj_5_6_comparison` | 870 | 0 (raw 0) | Y | n | Y | Y | 1.0 | 110 |
| 5 | `tmpl_image_description_question` | `rule_obj_6_8_comparison` | 70 | 0 (raw 0) | n | n | n | n | 1.0 | 110 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_age_5_6_facts`:** objectiveRank=3000, exactAge=500, exactGrade=0, exactSubject=200, exactDifficulty=100, rulePriority=100, objectiveExactBoost=120
- **#2 `rule_obj_5_6_counting`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=200, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#3 `rule_age_6_8_qa`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=0, rulePriority=100, objectiveExactBoost=-40
- **#4 `rule_obj_5_6_comparison`:** objectiveRank=0, exactAge=500, exactGrade=0, exactSubject=200, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#5 `rule_obj_6_8_comparison`:** objectiveRank=0, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=0, rulePriority=110, objectiveExactBoost=-40

</details>

## recognition age default 2-3

- **Query:** `Animals`
- **Age group:** 2-3
- **Resolved:** objective=`recognition`, confidence=`age_default`, topic=`Animals`
- **Winner:** `tmpl_large_image_word` via rule `rule_age_2_3_recognition` (expected `tmpl_large_image_word`)
- **Gaps:** total score #1−#2=500, objective tier #1−#2=0 **FRAGILE**

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_large_image_word` | `rule_age_2_3_recognition` | 2820 | 2 (raw 3) | Y | n | n | Y | 1.0 | 100 |
| 2 | `tmpl_image_word_sentence` | `rule_age_3_4_vocabulary` | 2320 | 2 (raw 3) | n | n | n | Y | 1.0 | 100 |
| 3 | `tmpl_image_word_sentence` | `rule_obj_3_4_comparison` | 2170 | 2 (raw 2) | n | n | n | Y | 1.0 | 110 |
| 4 | `tmpl_image_word_sentence` | `rule_obj_3_4_sorting` | 2170 | 2 (raw 2) | n | n | n | Y | 1.0 | 110 |
| 5 | `tmpl_image_word_sentence` | `rule_obj_3_4_counting` | 170 | 0 (raw 0) | n | n | n | Y | 1.0 | 110 |
| 6 | `tmpl_image_word_sentence` | `rule_obj_3_4_phonics` | 170 | 0 (raw 0) | n | n | n | Y | 1.0 | 110 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_age_2_3_recognition`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=120
- **#2 `rule_age_3_4_vocabulary`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=120
- **#3 `rule_obj_3_4_comparison`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#4 `rule_obj_3_4_sorting`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#5 `rule_obj_3_4_counting`:** objectiveRank=0, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#6 `rule_obj_3_4_phonics`:** objectiveRank=0, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40

</details>

## general knowledge age default 10-12

- **Query:** `World capitals`
- **Age group:** 10-12
- **Resolved:** objective=`general_knowledge`, confidence=`age_default`, topic=`World capitals`
- **Winner:** `tmpl_image_fact_quiz` via rule `rule_age_8_plus_quiz` (expected `tmpl_image_fact_quiz`)
- **Gaps:** total score #1−#2=n/a, objective tier #1−#2=n/a

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_image_fact_quiz` | `rule_age_8_plus_quiz` | 2320 | 2 (raw 3) | n | n | n | Y | 1.0 | 100 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_age_8_plus_quiz`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=120

</details>

## match pairs

- **Query:** `Match animal pairs`
- **Age group:** 3-4
- **Resolved:** objective=`matching`, confidence=`exact_keyword`, topic=`Match animal pairs`
- **Winner:** `tmpl_image_word_sentence` via rule `rule_obj_3_4_comparison` (expected `tmpl_image_word_sentence`)
- **Gaps:** total score #1−#2=0, objective tier #1−#2=0 **FRAGILE**

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_image_word_sentence` | `rule_obj_3_4_comparison` | 3830 | 3 (raw 3) | Y | n | n | Y | 1.0 | 110 |
| 2 | `tmpl_image_word_sentence` | `rule_obj_3_4_counting` | 3830 | 3 (raw 3) | Y | n | n | Y | 1.0 | 110 |
| 3 | `tmpl_image_word_sentence` | `rule_obj_3_4_sorting` | 3830 | 3 (raw 3) | Y | n | n | Y | 1.0 | 110 |
| 4 | `tmpl_image_word_sentence` | `rule_age_3_4_vocabulary` | 2660 | 2 (raw 2) | Y | n | n | Y | 1.0 | 100 |
| 5 | `tmpl_large_image_word` | `rule_age_2_3_recognition` | 2160 | 2 (raw 2) | n | n | n | Y | 1.0 | 100 |
| 6 | `tmpl_image_word_sentence` | `rule_obj_3_4_phonics` | 670 | 0 (raw 0) | Y | n | n | Y | 1.0 | 110 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_obj_3_4_comparison`:** objectiveRank=3000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=120
- **#2 `rule_obj_3_4_counting`:** objectiveRank=3000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=120
- **#3 `rule_obj_3_4_sorting`:** objectiveRank=3000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=120
- **#4 `rule_age_3_4_vocabulary`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#5 `rule_age_2_3_recognition`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#6 `rule_obj_3_4_phonics`:** objectiveRank=0, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40

</details>

## classify categories

- **Query:** `Classify fruits and vegetables`
- **Age group:** 5-6
- **Resolved:** objective=`classification`, confidence=`exact_keyword`, topic=`Classify fruits and vegetables`
- **Winner:** `tmpl_image_word_fact` via rule `rule_obj_5_6_comparison` (expected `tmpl_image_word_fact`)
- **Gaps:** total score #1−#2=600, objective tier #1−#2=0 **FRAGILE**

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_image_word_fact` | `rule_obj_5_6_comparison` | 3830 | 3 (raw 3) | Y | n | n | Y | 1.0 | 110 |
| 2 | `tmpl_image_description_question` | `rule_obj_6_8_comparison` | 3230 | 3 (raw 3) | n | n | n | n | 1.0 | 110 |
| 3 | `tmpl_image_word_fact` | `rule_obj_5_6_counting` | 2670 | 2 (raw 2) | Y | n | n | Y | 1.0 | 110 |
| 4 | `tmpl_image_description_question` | `rule_age_6_8_qa` | 2060 | 2 (raw 2) | n | n | n | n | 1.0 | 100 |
| 5 | `tmpl_image_word_fact` | `rule_age_5_6_facts` | 1660 | 1 (raw 1) | Y | n | n | Y | 1.0 | 100 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_obj_5_6_comparison`:** objectiveRank=3000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=120
- **#2 `rule_obj_6_8_comparison`:** objectiveRank=3000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=0, rulePriority=110, objectiveExactBoost=120
- **#3 `rule_obj_5_6_counting`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#4 `rule_age_6_8_qa`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=0, rulePriority=100, objectiveExactBoost=-40
- **#5 `rule_age_5_6_facts`:** objectiveRank=1000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40

</details>

## reading story

- **Query:** `Read a short story about birds`
- **Age group:** 6-8
- **Resolved:** objective=`reading`, confidence=`exact_keyword`, topic=`Read short story birds`
- **Winner:** `tmpl_image_description_question` via rule `rule_obj_6_8_comparison` (expected `tmpl_image_description_question`)
- **Gaps:** total score #1−#2=10, objective tier #1−#2=0 **FRAGILE**

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_image_description_question` | `rule_obj_6_8_comparison` | 3830 | 3 (raw 3) | Y | n | n | Y | 1.0 | 110 |
| 2 | `tmpl_image_description_question` | `rule_age_6_8_qa` | 3820 | 3 (raw 3) | Y | n | n | Y | 1.0 | 100 |
| 3 | `tmpl_image_word_fact` | `rule_obj_5_6_counting` | 2170 | 2 (raw 2) | n | n | n | Y | 1.0 | 110 |
| 4 | `tmpl_image_word_fact` | `rule_age_5_6_facts` | 2160 | 2 (raw 2) | n | n | n | Y | 1.0 | 100 |
| 5 | `tmpl_image_fact_quiz` | `rule_age_8_plus_quiz` | 2160 | 2 (raw 2) | n | n | n | Y | 1.0 | 100 |
| 6 | `tmpl_image_word_fact` | `rule_obj_5_6_comparison` | 170 | 0 (raw 0) | n | n | n | Y | 1.0 | 110 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_obj_6_8_comparison`:** objectiveRank=3000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=120
- **#2 `rule_age_6_8_qa`:** objectiveRank=3000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=120
- **#3 `rule_obj_5_6_counting`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#4 `rule_age_5_6_facts`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#5 `rule_age_8_plus_quiz`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#6 `rule_obj_5_6_comparison`:** objectiveRank=0, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40

</details>

## how many counting

- **Query:** `How many apples are there?`
- **Age group:** 5-6
- **Resolved:** objective=`counting`, confidence=`exact_keyword`, topic=`How many apples are there`
- **Winner:** `tmpl_image_word_fact` via rule `rule_obj_5_6_counting` (expected `tmpl_image_word_fact`)
- **Gaps:** total score #1−#2=1170, objective tier #1−#2=1

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_image_word_fact` | `rule_obj_5_6_counting` | 3830 | 3 (raw 3) | Y | n | n | Y | 1.0 | 110 |
| 2 | `tmpl_image_word_fact` | `rule_age_5_6_facts` | 2660 | 2 (raw 2) | Y | n | n | Y | 1.0 | 100 |
| 3 | `tmpl_image_description_question` | `rule_age_6_8_qa` | 2060 | 2 (raw 2) | n | n | n | n | 1.0 | 100 |
| 4 | `tmpl_image_word_fact` | `rule_obj_5_6_comparison` | 670 | 0 (raw 0) | Y | n | n | Y | 1.0 | 110 |
| 5 | `tmpl_image_description_question` | `rule_obj_6_8_comparison` | 70 | 0 (raw 0) | n | n | n | n | 1.0 | 110 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_obj_5_6_counting`:** objectiveRank=3000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=120
- **#2 `rule_age_5_6_facts`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#3 `rule_age_6_8_qa`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=0, rulePriority=100, objectiveExactBoost=-40
- **#4 `rule_obj_5_6_comparison`:** objectiveRank=0, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#5 `rule_obj_6_8_comparison`:** objectiveRank=0, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=0, rulePriority=110, objectiveExactBoost=-40

</details>

## difference comparison phrasing

- **Query:** `Show the difference between cats and dogs`
- **Age group:** 5-6
- **Resolved:** objective=`comparison`, confidence=`exact_keyword`, topic=`difference between cats and dogs`
- **Winner:** `tmpl_image_word_fact` via rule `rule_obj_5_6_comparison` (expected `tmpl_image_word_fact`)
- **Gaps:** total score #1−#2=600, objective tier #1−#2=0 **FRAGILE**

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_image_word_fact` | `rule_obj_5_6_comparison` | 3830 | 3 (raw 3) | Y | n | n | Y | 1.0 | 110 |
| 2 | `tmpl_image_description_question` | `rule_obj_6_8_comparison` | 3230 | 3 (raw 3) | n | n | n | n | 1.0 | 110 |
| 3 | `tmpl_image_word_fact` | `rule_obj_5_6_counting` | 2670 | 2 (raw 2) | Y | n | n | Y | 1.0 | 110 |
| 4 | `tmpl_image_word_fact` | `rule_age_5_6_facts` | 2660 | 2 (raw 2) | Y | n | n | Y | 1.0 | 100 |
| 5 | `tmpl_image_description_question` | `rule_age_6_8_qa` | 2060 | 2 (raw 2) | n | n | n | n | 1.0 | 100 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_obj_5_6_comparison`:** objectiveRank=3000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=120
- **#2 `rule_obj_6_8_comparison`:** objectiveRank=3000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=0, rulePriority=110, objectiveExactBoost=120
- **#3 `rule_obj_5_6_counting`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#4 `rule_age_5_6_facts`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#5 `rule_age_6_8_qa`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=0, rulePriority=100, objectiveExactBoost=-40

</details>

## explicit phonics

- **Query:** `Generate phonics flashcards for alphabet`
- **Age group:** 4-5
- **Resolved:** objective=`phonics`, confidence=`exact_keyword`, topic=`phonics alphabet`
- **Winner:** `tmpl_image_word_sentence` via rule `rule_obj_3_4_phonics` (expected `tmpl_image_word_sentence`)
- **Gaps:** total score #1−#2=1160, objective tier #1−#2=1

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_image_word_sentence` | `rule_obj_3_4_phonics` | 3330 | 3 (raw 3) | n | n | n | Y | 1.0 | 110 |
| 2 | `tmpl_image_word_fact` | `rule_obj_5_6_counting` | 2170 | 2 (raw 2) | n | n | n | Y | 1.0 | 110 |
| 3 | `tmpl_image_word_sentence` | `rule_age_3_4_vocabulary` | 2160 | 2 (raw 2) | n | n | n | Y | 1.0 | 100 |
| 4 | `tmpl_image_word_fact` | `rule_age_5_6_facts` | 2160 | 2 (raw 2) | n | n | n | Y | 1.0 | 100 |
| 5 | `tmpl_image_word_sentence` | `rule_obj_3_4_comparison` | 170 | 0 (raw 0) | n | n | n | Y | 1.0 | 110 |
| 6 | `tmpl_image_word_sentence` | `rule_obj_3_4_counting` | 170 | 0 (raw 0) | n | n | n | Y | 1.0 | 110 |
| 7 | `tmpl_image_word_sentence` | `rule_obj_3_4_sorting` | 170 | 0 (raw 0) | n | n | n | Y | 1.0 | 110 |
| 8 | `tmpl_image_word_fact` | `rule_obj_5_6_comparison` | 170 | 0 (raw 0) | n | n | n | Y | 1.0 | 110 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_obj_3_4_phonics`:** objectiveRank=3000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=120
- **#2 `rule_obj_5_6_counting`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#3 `rule_age_3_4_vocabulary`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#4 `rule_age_5_6_facts`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#5 `rule_obj_3_4_comparison`:** objectiveRank=0, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#6 `rule_obj_3_4_counting`:** objectiveRank=0, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#7 `rule_obj_3_4_sorting`:** objectiveRank=0, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#8 `rule_obj_5_6_comparison`:** objectiveRank=0, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40

</details>

## spot recognition

- **Query:** `Spot the red objects`
- **Age group:** 2-3
- **Resolved:** objective=`recognition`, confidence=`exact_keyword`, topic=`Spot red objects`
- **Winner:** `tmpl_large_image_word` via rule `rule_age_2_3_recognition` (expected `tmpl_large_image_word`)
- **Gaps:** total score #1−#2=500, objective tier #1−#2=0 **FRAGILE**

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_large_image_word` | `rule_age_2_3_recognition` | 3820 | 3 (raw 3) | Y | n | n | Y | 1.0 | 100 |
| 2 | `tmpl_image_word_sentence` | `rule_age_3_4_vocabulary` | 3320 | 3 (raw 3) | n | n | n | Y | 1.0 | 100 |
| 3 | `tmpl_image_word_sentence` | `rule_obj_3_4_comparison` | 2170 | 2 (raw 2) | n | n | n | Y | 1.0 | 110 |
| 4 | `tmpl_image_word_sentence` | `rule_obj_3_4_sorting` | 2170 | 2 (raw 2) | n | n | n | Y | 1.0 | 110 |
| 5 | `tmpl_image_word_sentence` | `rule_obj_3_4_counting` | 170 | 0 (raw 0) | n | n | n | Y | 1.0 | 110 |
| 6 | `tmpl_image_word_sentence` | `rule_obj_3_4_phonics` | 170 | 0 (raw 0) | n | n | n | Y | 1.0 | 110 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_age_2_3_recognition`:** objectiveRank=3000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=120
- **#2 `rule_age_3_4_vocabulary`:** objectiveRank=3000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=120
- **#3 `rule_obj_3_4_comparison`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#4 `rule_obj_3_4_sorting`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#5 `rule_obj_3_4_counting`:** objectiveRank=0, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#6 `rule_obj_3_4_phonics`:** objectiveRank=0, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40

</details>

## grade 1 vegetables EVS

- **Query:** `Generate 12 flashcards on vegetables for Grade 1`
- **Age group:** 5-6
- **Resolved:** objective=`vocabulary`, confidence=`age_default`, topic=`12 vegetables`
- **Winner:** `tmpl_image_word_fact` via rule `rule_obj_5_6_counting` (expected `tmpl_image_word_fact`)
- **Gaps:** total score #1−#2=10, objective tier #1−#2=0 **FRAGILE**

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_image_word_fact` | `rule_obj_5_6_counting` | 2830 | 2 (raw 3) | Y | n | n | Y | 1.0 | 110 |
| 2 | `tmpl_image_word_fact` | `rule_age_5_6_facts` | 2820 | 2 (raw 3) | Y | n | n | Y | 1.0 | 100 |
| 3 | `tmpl_image_description_question` | `rule_obj_6_8_comparison` | 2070 | 2 (raw 2) | n | n | n | n | 1.0 | 110 |
| 4 | `tmpl_image_description_question` | `rule_age_6_8_qa` | 2060 | 2 (raw 2) | n | n | n | n | 1.0 | 100 |
| 5 | `tmpl_image_word_fact` | `rule_obj_5_6_comparison` | 670 | 0 (raw 0) | Y | n | n | Y | 1.0 | 110 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_obj_5_6_counting`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=120
- **#2 `rule_age_5_6_facts`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=120
- **#3 `rule_obj_6_8_comparison`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=0, rulePriority=110, objectiveExactBoost=-40
- **#4 `rule_age_6_8_qa`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=0, rulePriority=100, objectiveExactBoost=-40
- **#5 `rule_obj_5_6_comparison`:** objectiveRank=0, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40

</details>

## vs comparison shorthand

- **Query:** `Lion vs tiger`
- **Age group:** 6-8
- **Resolved:** objective=`comparison`, confidence=`exact_keyword`, topic=`Lion vs tiger`
- **Winner:** `tmpl_image_description_question` via rule `rule_obj_6_8_comparison` (expected `tmpl_image_description_question`)
- **Gaps:** total score #1−#2=500, objective tier #1−#2=0 **FRAGILE**

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_image_description_question` | `rule_obj_6_8_comparison` | 3830 | 3 (raw 3) | Y | n | n | Y | 1.0 | 110 |
| 2 | `tmpl_image_word_fact` | `rule_obj_5_6_comparison` | 3330 | 3 (raw 3) | n | n | n | Y | 1.0 | 110 |
| 3 | `tmpl_image_description_question` | `rule_age_6_8_qa` | 2660 | 2 (raw 2) | Y | n | n | Y | 1.0 | 100 |
| 4 | `tmpl_image_word_fact` | `rule_obj_5_6_counting` | 2170 | 2 (raw 2) | n | n | n | Y | 1.0 | 110 |
| 5 | `tmpl_image_word_fact` | `rule_age_5_6_facts` | 2160 | 2 (raw 2) | n | n | n | Y | 1.0 | 100 |
| 6 | `tmpl_image_fact_quiz` | `rule_age_8_plus_quiz` | 1160 | 1 (raw 1) | n | n | n | Y | 1.0 | 100 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_obj_6_8_comparison`:** objectiveRank=3000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=120
- **#2 `rule_obj_5_6_comparison`:** objectiveRank=3000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=120
- **#3 `rule_age_6_8_qa`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#4 `rule_obj_5_6_counting`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#5 `rule_age_5_6_facts`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#6 `rule_age_8_plus_quiz`:** objectiveRank=1000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40

</details>

## group sorting phrasing

- **Query:** `Group shapes by size`
- **Age group:** 3-4
- **Resolved:** objective=`sorting`, confidence=`exact_keyword`, topic=`Group shapes by size`
- **Winner:** `tmpl_image_word_sentence` via rule `rule_obj_3_4_sorting` (expected `tmpl_image_word_sentence`)
- **Gaps:** total score #1−#2=1160, objective tier #1−#2=1

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_image_word_sentence` | `rule_obj_3_4_sorting` | 3830 | 3 (raw 3) | Y | n | n | Y | 1.0 | 110 |
| 2 | `tmpl_image_word_sentence` | `rule_obj_3_4_comparison` | 2670 | 2 (raw 2) | Y | n | n | Y | 1.0 | 110 |
| 3 | `tmpl_image_word_sentence` | `rule_obj_3_4_counting` | 2670 | 2 (raw 2) | Y | n | n | Y | 1.0 | 110 |
| 4 | `tmpl_image_word_sentence` | `rule_age_3_4_vocabulary` | 2660 | 2 (raw 2) | Y | n | n | Y | 1.0 | 100 |
| 5 | `tmpl_large_image_word` | `rule_age_2_3_recognition` | 2160 | 2 (raw 2) | n | n | n | Y | 1.0 | 100 |
| 6 | `tmpl_image_word_sentence` | `rule_obj_3_4_phonics` | 670 | 0 (raw 0) | Y | n | n | Y | 1.0 | 110 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_obj_3_4_sorting`:** objectiveRank=3000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=120
- **#2 `rule_obj_3_4_comparison`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#3 `rule_obj_3_4_counting`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#4 `rule_age_3_4_vocabulary`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#5 `rule_age_2_3_recognition`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#6 `rule_obj_3_4_phonics`:** objectiveRank=0, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40

</details>

## calculate verb counting

- **Query:** `Calculate how many stars`
- **Age group:** 5-6
- **Resolved:** objective=`counting`, confidence=`exact_keyword`, topic=`Calculate how many stars`
- **Winner:** `tmpl_image_word_fact` via rule `rule_obj_5_6_counting` (expected `tmpl_image_word_fact`)
- **Gaps:** total score #1−#2=1170, objective tier #1−#2=1

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_image_word_fact` | `rule_obj_5_6_counting` | 3830 | 3 (raw 3) | Y | n | n | Y | 1.0 | 110 |
| 2 | `tmpl_image_word_fact` | `rule_age_5_6_facts` | 2660 | 2 (raw 2) | Y | n | n | Y | 1.0 | 100 |
| 3 | `tmpl_image_description_question` | `rule_age_6_8_qa` | 2060 | 2 (raw 2) | n | n | n | n | 1.0 | 100 |
| 4 | `tmpl_image_word_fact` | `rule_obj_5_6_comparison` | 670 | 0 (raw 0) | Y | n | n | Y | 1.0 | 110 |
| 5 | `tmpl_image_description_question` | `rule_obj_6_8_comparison` | 70 | 0 (raw 0) | n | n | n | n | 1.0 | 110 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_obj_5_6_counting`:** objectiveRank=3000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=120
- **#2 `rule_age_5_6_facts`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#3 `rule_age_6_8_qa`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=0, rulePriority=100, objectiveExactBoost=-40
- **#4 `rule_obj_5_6_comparison`:** objectiveRank=0, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#5 `rule_obj_6_8_comparison`:** objectiveRank=0, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=0, rulePriority=110, objectiveExactBoost=-40

</details>

## add verb counting

- **Query:** `Add the apples`
- **Age group:** 5-6
- **Resolved:** objective=`counting`, confidence=`exact_keyword`, topic=`Add apples`
- **Winner:** `tmpl_image_word_fact` via rule `rule_obj_5_6_counting` (expected `tmpl_image_word_fact`)
- **Gaps:** total score #1−#2=1170, objective tier #1−#2=1

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_image_word_fact` | `rule_obj_5_6_counting` | 3830 | 3 (raw 3) | Y | n | n | Y | 1.0 | 110 |
| 2 | `tmpl_image_word_fact` | `rule_age_5_6_facts` | 2660 | 2 (raw 2) | Y | n | n | Y | 1.0 | 100 |
| 3 | `tmpl_image_description_question` | `rule_age_6_8_qa` | 2060 | 2 (raw 2) | n | n | n | n | 1.0 | 100 |
| 4 | `tmpl_image_word_fact` | `rule_obj_5_6_comparison` | 670 | 0 (raw 0) | Y | n | n | Y | 1.0 | 110 |
| 5 | `tmpl_image_description_question` | `rule_obj_6_8_comparison` | 70 | 0 (raw 0) | n | n | n | n | 1.0 | 110 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_obj_5_6_counting`:** objectiveRank=3000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=120
- **#2 `rule_age_5_6_facts`:** objectiveRank=2000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#3 `rule_age_6_8_qa`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=0, rulePriority=100, objectiveExactBoost=-40
- **#4 `rule_obj_5_6_comparison`:** objectiveRank=0, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#5 `rule_obj_6_8_comparison`:** objectiveRank=0, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=0, rulePriority=110, objectiveExactBoost=-40

</details>

## reading in range phrasing

- **Query:** `Reading in range practice`
- **Age group:** 6-8
- **Resolved:** objective=`reading`, confidence=`exact_keyword`, topic=`Reading range practice`
- **Winner:** `tmpl_image_description_question` via rule `rule_obj_6_8_comparison` (expected `tmpl_image_description_question`)
- **Gaps:** total score #1−#2=10, objective tier #1−#2=0 **FRAGILE**

| Rank | Template | Rule ID | Total | Obj tier (eff) | Age | Grade | Subject | Diff | Ver | Priority |
|---|---|---|---:|---:|:-:|:-:|:-:|:-:|:-:|---:|
| 1 | `tmpl_image_description_question` | `rule_obj_6_8_comparison` | 3830 | 3 (raw 3) | Y | n | n | Y | 1.0 | 110 |
| 2 | `tmpl_image_description_question` | `rule_age_6_8_qa` | 3820 | 3 (raw 3) | Y | n | n | Y | 1.0 | 100 |
| 3 | `tmpl_image_word_fact` | `rule_obj_5_6_counting` | 2170 | 2 (raw 2) | n | n | n | Y | 1.0 | 110 |
| 4 | `tmpl_image_word_fact` | `rule_age_5_6_facts` | 2160 | 2 (raw 2) | n | n | n | Y | 1.0 | 100 |
| 5 | `tmpl_image_fact_quiz` | `rule_age_8_plus_quiz` | 2160 | 2 (raw 2) | n | n | n | Y | 1.0 | 100 |
| 6 | `tmpl_image_word_fact` | `rule_obj_5_6_comparison` | 170 | 0 (raw 0) | n | n | n | Y | 1.0 | 110 |

<details><summary>Score component detail (all candidates)</summary>

- **#1 `rule_obj_6_8_comparison`:** objectiveRank=3000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=120
- **#2 `rule_age_6_8_qa`:** objectiveRank=3000, exactAge=500, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=120
- **#3 `rule_obj_5_6_counting`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40
- **#4 `rule_age_5_6_facts`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#5 `rule_age_8_plus_quiz`:** objectiveRank=2000, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=100, objectiveExactBoost=-40
- **#6 `rule_obj_5_6_comparison`:** objectiveRank=0, exactAge=0, exactGrade=0, exactSubject=0, exactDifficulty=100, rulePriority=110, objectiveExactBoost=-40

</details>


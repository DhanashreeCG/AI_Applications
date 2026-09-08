# Worksheet Template Selection Fixes

## Introduction

The goal is to make the template selection process for worksheets consistent with that of flashcards. This document outlines the necessary changes and considerations to achieve this consistency.

## Key Differences Between Flashcard and Worksheet Template Selection

1. **Explicit ID/Slug**:
   - **Flashcards**: Require an explicit ID or slug to select a template.
   - **Worksheets**: Also allow an explicit ID or slug, but do not have a reserved default template.

2. **Request Parameters**:
   - **Flashcards**: Use a set of parameters such as `grade`, `subject`, `topic`, and `difficulty`.
   - **Worksheets**: Similar parameters, but also consider `ageGroup` and `language`.

3. **Eligibility Rules**:
   - **Flashcards**: Use `TemplateSelectionRule` and synthetic rules to filter templates.
   - **Worksheets**: Use `meta` JSON in the template to filter templates.

4. **Scoring and Ranking**:
   - **Flashcards**: Assign points based on parameter matches and use LLM reranking.
   - **Worksheets**: Assign points based on parameter matches but no LLM reranking.

5. **Catalog and List Matching**:
   - **Flashcards**: Have distinct endpoints for catalog (`listCatalog`) and list matching (`listMatching`).
   - **Worksheets**: Consolidate functionality into single endpoints (`select` and `listMatching`).

## Implementation Steps

### 1. Modify Template Metadata

Ensure that the `meta` field in the `WorksheetTemplate` schema includes all necessary parameters such as `grades`, `subjects`, `topics`, `difficulty`, `ageMin`, `ageMax`, and `language`.

### 2. Update Template Selection Service

Update the `WorksheetTemplateSelectionService` to use the same logic as the flashcard system for filtering and scoring templates.

- **Filtering**: Use the `meta` field to filter templates based on request parameters.
- **Scoring**: Assign points based on parameter matches.
- **Ranking**: Use a stable sort to rank templates based on score, then `updatedAt` and `id`.

### 3. Modify Generate-Set Logic

Update the `listMatching` logic to use the same rules as the flashcard system for generating multiple worksheets.

- **Explicit ID**: If an explicit template ID or slug is provided, skip deterministic selection and return only the requested template.
- **Pool**: Active templates that pass eligibility rules.
- **Sorting**: Sort templates by score and `updatedAt` descending.
- **Selection**: Take the first `limit` templates from the pool.

### 4. Consolidate Catalog and List Matching Endpoints

Combine the `listCatalog` and `listMatching` endpoints into a single endpoint that handles both scenarios.

### 5. Handle Explicit ID/Slug

Ensure that the system correctly handles explicit IDs or slugs for template selection, similar to flashcards.

### 6. Update Documentation and Testing

Update the documentation and write tests to verify that the new implementation works as expected.

## Conclusion

By making the necessary changes to the template selection process, we can ensure that worksheets are selected in a manner consistent with the flashcard system. This will improve usability and make the system more intuitive for users.

---

## References

- [Flashcard Template Selection](FLASHCARD_TEMPLATE_SELECTION.md)
- [Worksheet Generation Architecture](WORKSHEET_GENERATION_ARCHITECTURE.md)
- [Worksheet Template Selection](WORKSHEET_TEMPLATE_SELECTION.md)
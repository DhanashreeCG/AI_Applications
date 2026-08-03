# Flashcard Template Engine – Backend Design Prompt

You are acting as a Principal Software Architect and Senior Backend Engineer.

Design and implement a **highly scalable, template-driven flashcard generation module** that integrates with the existing AI Asset Library and Search API.

Do **NOT** redesign or modify the existing Asset Library, Asset Ingestion Pipeline, Embedding Pipeline, Search API, Rendering Engine, or Image Storage. These already exist and must be consumed as independent services.

The goal is to design the **Flashcard Template System**, **Template Selection Engine**, **Content Generation Flow**, and the **Backend Response Contract** that will be consumed by the Rendering Engine.

---

# Existing System

The following components already exist:

* Asset Library
* Semantic Search API
* PGVector embeddings
* Asset Metadata
* S3 image storage
* Redis caching
* BullMQ
* AI metadata generation
* Image retrieval service

The backend can either consume the Search API or directly call the internal Search Service.

Do not duplicate image searching logic.

---

# Objective

Design a backend module that converts a request like:

> Generate flashcards on vegetables for age 3–4

into a structured response by following these stages:

1. Identify educational intent.
2. Determine learner age group.
3. Select the most appropriate flashcard template.
4. Generate only educational content using the LLM.
5. Retrieve images from the existing Asset Library.
6. Merge template + content + images.
7. Return a rendering-ready JSON response.

The backend **must not render HTML, Canvas, PDF, or images**.

Its only responsibility is returning a structured response.

---

# Core Design Principles

The implementation must strictly separate:

* Presentation
* Educational Logic
* AI Content
* Asset Retrieval

The LLM must never generate UI layouts.

The LLM must never decide component positioning.

The backend owns template selection.

The rendering engine owns visualization.

---

# Flashcard Template Database

Design a database schema for reusable flashcard templates.

Each template should represent only layout metadata.

A template must never contain educational content.

Each template should include fields similar to:

* id
* name
* description
* supportedAgeMin
* supportedAgeMax
* supportedGrades (optional)
* learningObjectives
* subjectsSupported
* difficultyLevels
* templateVersion
* active
* layoutDefinition
* editableComponents
* componentHierarchy
* componentConstraints
* renderingHints
* defaultStyles
* createdAt
* updatedAt

The layoutDefinition should describe the component structure only.

Example components:

* image
* title
* subtitle
* sentence
* fact
* question
* answer
* footer
* badge
* pronunciation
* phonics

Every component must have a stable identifier.

These identifiers will later be used by the rendering engine for inline editing.

---

# Template Selection Engine

Design a deterministic template selection engine.

The LLM must never select templates.

Template selection should consider:

* age
* grade
* subject
* user intent
* requested topic
* learning objective
* difficulty

Example:

Age 2–3

→ Large Image + Single Word

Age 3–4

→ Large Image + Word + Simple Sentence

Age 5–6

→ Image + Word + Educational Fact

Age 6–8

→ Image + Description + Question

Age 8+

→ Image + Fact + Quiz

This mapping should be configurable.

No hardcoded if/else chains throughout the project.

---

# Learning Objectives

Do not organize templates by topic.

Organize templates by educational objective.

Examples:

Vocabulary

Recognition

Reading

Classification

Comparison

Memory

Science Facts

Language Learning

General Knowledge

Matching

Counting

Question & Answer

Sorting

Identification

A fruit, vegetable, animal, or vehicle should all be able to reuse the same template.

---

# Generate Flashcard API Flow

The backend should execute the following flow.

User Request

↓

Validate request

↓

Identify:

* age
* grade
* subject
* topic
* difficulty

↓

Determine learning objective

↓

Select best template

↓

Construct an LLM prompt using:

* user topic
* age
* educational objective
* selected template contract

↓

Generate educational content only

↓

Validate LLM response

↓

Extract image search queries

↓

Search Asset Library

↓

Attach best matching image

↓

Produce final backend response

↓

Return response to Rendering Engine

---

# LLM Contract

The LLM must never generate layout information.

The prompt should instruct the LLM to return only structured educational content.

Examples:

Title

Sentence

Fact

Question

Answer

Pronunciation

Image Search Query

Nothing related to positioning or styling.

The backend owns presentation.

---

# Image Retrieval

Each flashcard should contain one or more asset queries.

For every asset query:

Call the existing Search Service.

Retrieve the best matching asset.

Support configurable parallel image retrieval with bounded concurrency.

Do not block the entire request if one image fails.

If no suitable image exists:

* retry using simplified search query
* retry using object name only
* retry without filters

If still unavailable:

Return the component with a null image and appropriate status.

Never fail the entire flashcard generation because one image could not be found.

---

# Response Contract

The backend response should contain:

Selected template

Generated educational content

Retrieved image metadata

Editable component identifiers

Rendering metadata

Everything required by the Rendering Engine.

The Rendering Engine should not need to perform additional AI calls.

---

# Editable Components

Every visible component must have:

componentId

componentType

editable

content

validationRules

assetReference (if applicable)

Examples:

Image

Title

Sentence

Question

Answer

Fact

This allows the Rendering Engine to edit each component independently.

Replacing a title should never affect the image.

Replacing an image should never affect the text.

---

# Validation

Validate all LLM responses before continuing.

Reject malformed JSON.

Reject missing required fields.

Reject unexpected component types.

Reject invalid educational content.

Ensure every generated card satisfies the selected template contract.

---

# Error Handling

Handle all edge cases.

Examples include:

No template found

Unsupported age

Unsupported subject

Invalid LLM output

Image search timeout

Image search returns zero assets

Duplicate asset results

Asset unavailable

Partial search failures

LLM timeout

Retry exhaustion

Template version mismatch

Unknown learning objective

Missing editable component

Return structured errors.

Never return partially malformed responses.

---

# Extensibility

The architecture should support future template additions without modifying existing business logic.

Adding a new flashcard type should require:

* inserting a new template
* configuring selection rules

No renderer changes.

No LLM changes.

No backend orchestration changes.

---

# Non-Functional Requirements

The design must prioritize:

* High scalability
* Low coupling
* Reusable templates
* Deterministic template selection
* Strict separation of concerns
* Configurable mappings
* Easy template versioning
* Backward compatibility
* High testability
* Future support for multilingual flashcards
* Future support for multiple rendering engines

---

# Deliverables

Produce:

1. Flashcard Template database schema.
2. Template Selection Engine design.
3. Template repository/service architecture.
4. Template configuration model.
5. Generate Flashcard backend flow.
6. LLM prompt contract.
7. LLM response schema.
8. Backend response schema for the Rendering Engine.
9. Image retrieval orchestration.
10. Validation strategy.
11. Error handling strategy.
12. Extension strategy for new templates and educational objectives.

Do not implement the Rendering Engine. Treat it as a downstream consumer that receives a complete, rendering-ready JSON payload with editable component definitions.

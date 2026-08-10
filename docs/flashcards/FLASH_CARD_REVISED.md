# Flashcard Generation Engine – Updated Backend Design Prompt

## Objective

Refactor the Flashcard Generation Engine to use the new declarative template system.

The Rendering Engine, Asset Library, Search Service, Asset Metadata, Embedding Pipeline and Storage layer already exist and must remain unchanged.

The backend is responsible only for:

* Understanding the educational request
* Selecting the correct template
* Generating educational content
* Retrieving matching images
* Producing a rendering-ready JSON response

The backend must never generate layouts, styling information or rendering instructions.

---

# Updated Request Analysis

After validating the request, the backend must extract:

* grade (Highest priority)
* age group
* subject
* topic
* educational intent
* difficulty
* requested number of flashcards
* language

Example

Generate 12 flashcards on vegetables for Grade 1.

Extract

```
Grade : Grade 1
Age Group : 5-6
Subject : EVS
Topic : Vegetables
Difficulty : Beginner
Educational Intent : Vocabulary
Language : English
```

Educational intent should be inferred using deterministic rules.

Examples

Vocabulary

Recognition

Reading

Phonics

Classification

Comparison

Science Facts

Counting

Question & Answer

Matching

Sorting

General Knowledge

The LLM must never determine the educational intent.

---

# Template Selection Engine

The template selection engine must be completely deterministic.

The LLM must never select templates.

Selection priority

```
Grade
↓

Educational Objective

↓

Subject

↓

Difficulty

↓

Age Group

↓

Template Version

↓

Active Template
```

Topic must NOT determine the template.

Topics only affect generated educational content.

Example

Topic = Fruits

Topic = Vegetables

Topic = Animals

All may use the same Vocabulary template.

The engine should query the FlashcardTemplate repository using metadata only.

No hardcoded switch statements.

No if/else chains.

The selection logic must be configuration-driven.

If multiple templates satisfy the criteria, rank them using:

* exact grade match
* exact educational objective match
* exact subject match
* exact difficulty match
* newest active template version

Always return one template.

---

# Content Generation

The selected template becomes the contract for the LLM.

Only components defined inside layoutDefinition may be generated.

The LLM must never invent additional components.

The backend should construct a structured prompt containing

* user request
* topic
* learner profile
* educational objective
* selected component list
* language
* number of cards

The LLM should generate only educational data.

Never generate layout.

Never generate styling.

Never generate positioning.

Never generate rendering metadata.

---

# Educational Content Requirements

Content must follow educational best practices.

Difficulty must increase with learner grade.

Examples

Age 2–3

single word

Age 3–4

single word + simple sentence

Age 5–6

word + educational fact

Age 6–8

description + recognition question

Age 8+

fact + reasoning question

The generated content must always be:

* factually correct
* age appropriate
* curriculum aligned
* grammatically correct
* concise
* visually teachable

---

# Creative Content Generation

Repeated requests must not always generate identical flashcards.

The LLM should maximize educational diversity.

Example

User asks

Generate alphabet flashcards.

Do NOT always produce

A → Apple

B → Ball

C → Cat

Instead generate equally valid alternatives.

Examples

A

Apple

Ant

Avocado

Airplane

Anchor

Astronaut

B

Bear

Butterfly

Banana

Boat

Bee

Balloon

Selection should maximize educational variety while remaining age appropriate.

Similarly

Vegetables

Do not always begin with

Potato

Tomato

Carrot

Instead rotate among all suitable vegetables.

The backend should instruct the LLM to avoid repetitive examples across repeated generations whenever alternatives exist.

---

# Image Search Generation

The LLM should never return image filenames.

Instead generate semantic search queries.

Each image component must contain

```
searchQuery

expectedObjects

preferredStyle

preferredBackground

orientation

educationalUse
```

Example

```
searchQuery

cartoon green broccoli

expectedObjects

broccoli

preferredStyle

cartoon

preferredBackground

white

orientation

portrait

educationalUse

flashcard
```

Queries should prioritize precision over verbosity.

The generated query should maximize similarity search quality.

---

# Image Retrieval

For every image component

Execute the Search Service independently.

Parallel retrieval should use bounded concurrency.

Do not block the entire pipeline because one image fails.

Search priority

Primary semantic query

↓

Expected object

↓

Object name only

↓

Topic only

↓

No filters

Always keep the highest similarity result.

Duplicate assets should not appear within one flashcard set unless explicitly required.

When multiple equally good assets exist

Randomly rotate among the highest-ranked results to reduce visual repetition while maintaining relevance.

---

# LLM Output Validation

Reject

* malformed JSON
* missing components
* unsupported component ids
* unsupported component types
* empty required fields
* invalid educational content
* hallucinated layout information

Every generated component must exist inside the selected template.

No additional components are allowed.

---

# Response Generation

The backend should merge

Selected Template

*

Generated Educational Content

*

Retrieved Asset Metadata

into a single rendering-ready response.

The response should contain

```
template

templateVersion

layoutDefinition

cards

metadata
```

Each card should contain

```
cardId

components
```

Each component should contain

```
componentId

type

editable

content

validationRules

assetReference
```

Example

Image

```
{
  "componentId":"image",
  "type":"image",
  "editable":true,
  "assetReference":{
      "assetId":"...",
      "s3ObjectKey":"...",
      "mimeType":"image/png"
  }
}
```

Text

```
{
  "componentId":"title",
  "type":"text",
  "editable":true,
  "content":"Broccoli"
}
```

The Rendering Engine should require zero AI processing after receiving the response.

---

# Failure Handling

Continue processing whenever possible.

If image retrieval fails

Return

```
assetReference : null

status : IMAGE_NOT_FOUND
```

If one flashcard fails validation

Regenerate only that flashcard.

Never regenerate the complete flashcard set.

If the selected template becomes inactive during execution

Restart only the template selection phase.

Every stage must be independently retryable.

---

# Pipeline Requirements

Every stage must be independently observable and idempotent.

Stages

```
REQUEST_VALIDATION

REQUEST_ANALYSIS

EDUCATIONAL_OBJECTIVE_DETERMINATION

TEMPLATE_SELECTION

LLM_CONTENT_GENERATION

CONTENT_VALIDATION

IMAGE_QUERY_GENERATION

IMAGE_RETRIEVAL

RESPONSE_ASSEMBLY

FINAL_VALIDATION

RESPONSE_RETURN
```

Every stage must expose

* start time
* completion time
* duration
* retry count
* success
* failure reason
* execution id
* parent request id

The backend should support replay from the last successfully completed stage without repeating completed AI calls.

---

# Extensibility

Adding a new flashcard layout must require only

* inserting a new FlashcardTemplate
* configuring selection rules

No modifications should be required in

* orchestration
* rendering
* LLM prompt structure
* image retrieval pipeline
* response generation
* validation pipeline

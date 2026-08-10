# Flashcard Server-side Rendering Engine Implementation

## Role

You are a Senior Staff Software Engineer and System Architect.

Your task is to design and implement a production-grade, generic, server-side flashcard rendering engine for a NestJS application.

The rendering engine must work for all current flashcard templates and any future templates without requiring renderer modifications.

The implementation must be clean, extensible, scalable and production ready.

---

# Existing Architecture

The following pipeline already exists and MUST NOT be redesigned.

```
User Request
      │
      ▼
Template Selection
      │
      ▼
LLM Content Generation
      │
      ▼
GenerateFlashcardsResponse
      │
      ▼
Image Retrieval using Embeddings
      │
      ▼
AssetReference.imageUrl populated
      │
      ▼
Server-side Rendering
      │
      ▼
Store Generated Images
      │
      ▼
Generate PDF
```

Do NOT introduce

- another AI model
- another LLM call
- another embedding layer
- another database
- another metadata table
- another image processing service

The rendering engine must work only using the existing response object.

---

# Existing Interfaces

The rendering engine receives

```
GenerateFlashcardsResponse
```

which already contains

- request
- template
- layoutDefinition
- cards
- components
- AssetReference
- metadata

Do not modify these interfaces unless absolutely necessary.

Future compatibility should come from good architecture, not schema changes.

---

# Image Information

This is fixed.

Every retrieved image is

```
500 x 500 pixels
```

This will never change.

Do not calculate aspect ratios.

Do not generate different image sizes.

Do not resize original assets.

The renderer should simply display them correctly.

---

# Objective

Build a completely generic rendering engine capable of rendering every flashcard dynamically using only

```
layoutDefinition

+

EditableComponentPayload

+

AssetReference
```

The renderer must not know what

- Vocabulary
- Phonics
- Comparison
- Reading
- Fact
- Matching

means.

It should simply render what the template describes.

---

# Design Philosophy

The rendering engine should be driven entirely by data.

Never hardcode template names.

Never create template-specific renderers.

Bad

```
VocabularyRenderer

FactRenderer

MCQRenderer

ReadingRenderer
```

Good

```
GenericRenderer
```

Everything should come from

```
layoutDefinition
```

---

# Rendering Pipeline

The implementation should follow this pipeline.

```
GenerateFlashcardsResponse

        │

        ▼

Normalize Response

        │

        ▼

Resolve Images

        │

        ▼

Build HTML

        │

        ▼

Apply CSS Theme

        │

        ▼

Playwright

        │

 ┌──────┴────────┐

 ▼               ▼

WebP          PDF

        │

        ▼

Save locally

        │

        ▼

Return generated paths
```

---

# Rendering Strategy

Rendering should happen in the following order.

```
Card

↓

Regions

↓

Components

↓

Component Renderer
```

Never use template names.

Always iterate dynamically.

Pseudo logic

```
for each card

    render card

        for each region

            render region

                for each component

                    render component
```

---

# Component Rendering

Rendering should depend only on

```
componentType
```

Supported components

```
image

title

subtitle

sentence

fact

question

answer

badge

footer

phonics

chips
```

The renderer should contain one renderer per component type.

Example

```
ImageRenderer

TitleRenderer

QuestionRenderer

SentenceRenderer
```

NOT

```
VocabularyRenderer

FactRenderer
```

---

# Image Rendering

Images already exist.

Use

```
assetReference.imageUrl
```

If unavailable

use

```
assetReference.signedUrl
```

If both are missing

show a placeholder.

Never stop rendering because one image failed.

---

# Image Display Rules

Every image is exactly

```
500 x 500
```

Use

```
object-fit: contain

object-position: center
```

Do not crop educational content.

Do not stretch images.

Do not calculate aspect ratio.

Keep rendering logic simple.

---

# Text Rendering

The renderer is not responsible for educational correctness.

Render text exactly as received.

Do not

- capitalize
- lowercase
- trim
- rewrite
- translate
- shorten

Render exactly.

---

# Dynamic Collections

Some layouts contain

```
component-{x}

imageCollection

textCollection

chips

options
```

Never assume a fixed count.

Always iterate.

The renderer should work for

```
1 item

5 items

10 items

20 items
```

without code changes.

---

# Layout Rules

The renderer must never assume

```
Header

Body

Footer
```

Future layouts may contain

```
Center

Overlay

Stack

Column

Grid

Floating

Circle

Timeline
```

Render exactly in the order defined inside

```
layoutDefinition
```

Nothing should be hardcoded.

---

# Missing Components

If

```
content == null
```

Skip rendering.

If

```
image missing
```

Render placeholder.

Never fail the card.

---

# Styling

The styling should NOT come from templates.

Instead create a reusable design system.

Example principles

- rounded corners
- clean spacing
- centered content
- soft shadows
- modern typography
- proper padding
- balanced whitespace
- colorful but readable
- child friendly

Templates describe

```
WHAT
```

Renderer decides

```
HOW
```

---

# HTML Generation

Generate semantic HTML.

Do NOT generate HTML manually using string concatenation everywhere.

Create reusable renderers.

Example

```
renderCard()

renderRegion()

renderComponent()

renderImage()

renderTitle()

renderSentence()
```

Each renderer should be isolated.

---

# CSS

Create one reusable stylesheet.

Avoid inline CSS.

Organize CSS using

```
variables

layout

components

utilities
```

Keep it reusable.

---

# Browser Rendering

Use Playwright.

Launch Chromium once.

Reuse browser.

Never launch Chromium for every request.

Bad

```
launch

render

close
```

Good

```
launch once

browser pool

reuse pages

render

close page
```

---

# Parallel Rendering

Flashcards should render concurrently.

If one request contains

```
20 cards
```

render them in parallel using Promise.all with configurable concurrency.

Avoid blocking rendering.

---

# Image Optimization

Store

```
WebP
```

by default.

Use PNG only when transparency is required.

Target

- excellent visual quality
- small storage size
- fast download

---

# PDF Generation

Generate PDF from the rendered HTML.

Avoid rebuilding layouts.

The HTML should be the single source of truth.

Pipeline

```
HTML

↓

Playwright

↓

PDF
```

---

# Storage Structure

```
storage/

    flashcards/

        requestId/

            card-1.webp

            card-2.webp

            card-3.webp

            preview.webp

            flashcards.pdf
```

Keep files grouped by request.

---

# Performance Requirements

The renderer should

- reuse browser instances
- cache fonts
- cache CSS
- avoid repeated template parsing
- avoid unnecessary filesystem operations
- support multiple rendering workers
- support horizontal scaling

The renderer should be stateless.

---

# Error Handling

Rendering should never fail because

- one image missing
- one component empty
- one card invalid

Instead

- log warning
- continue rendering
- return partial success

---

# Logging

Log

- render time
- browser time
- HTML generation time
- image loading failures
- PDF generation time

Avoid excessive logging.

---

# Folder Structure

Suggested implementation

```
flashcard-renderer/

    renderer/

        renderer.service.ts

        card.renderer.ts

        region.renderer.ts

        component.renderer.ts

        image.renderer.ts

        title.renderer.ts

        sentence.renderer.ts

        chips.renderer.ts

    templates/

        flashcard.html

    styles/

        flashcard.css

    browser/

        browser.pool.ts

    storage/

        storage.service.ts

    pdf/

        pdf.service.ts
```

Keep responsibilities separated.

---

# Code Quality

The implementation should follow

- SOLID principles
- clean architecture
- dependency injection
- reusable services
- small focused classes
- minimal duplication
- production-ready logging
- proper error handling

Avoid giant renderer classes.

---

# Future Compatibility

The renderer should automatically support

- new templates
- new layouts
- new regions
- different page sizes
- different orientations

without renderer changes.

The only acceptable future code change should be supporting a genuinely new

```
ComponentType
```

Everything else should already work.

---

# Expected Deliverables

Implement

- Generic Renderer
- HTML Generator
- CSS Theme
- Playwright Renderer
- Browser Pool
- Local Storage Service
- PDF Generator
- Rendering Pipeline
- Error Handling
- Logging
- Parallel Rendering

The final implementation should be modular, scalable, maintainable, production-ready, and capable of rendering any flashcard template defined by `layoutDefinition` using the existing interfaces without requiring additional AI calls, schema changes, or database modifications.
# AI Asset Ingestion Architecture Refactor – Image Embedding First (Remove Vision Metadata Pipeline)

## Objective

We are redesigning the AI Asset Ingestion system to reduce ingestion cost, simplify the architecture, and improve long-term maintainability.

The previous architecture generated AI metadata using Gemini Vision and then generated OpenAI text embeddings from those captions.

That approach is now being replaced.

The new architecture must use **multimodal image embeddings directly from the images** and completely eliminate AI-generated metadata.

The purpose of this system is **NOT** to build an image search engine.

It is to support an AI-powered Worksheet and Flashcard generation platform.

The runtime flow will be:

```
User Query
        ↓
OpenAI
        ↓
Worksheet / Flashcard JSON
        ↓
Each image placeholder contains an image description
        ↓
Generate embedding for that description
        ↓
PGVector similarity search
        ↓
Retrieve matching image
        ↓
Render Template
        ↓
HTML / PDF / PNG
```

Therefore the retrieval system only needs to return the most semantically similar image.

We do NOT need AI-generated captions.

---

# Existing Project

Read and understand the existing implementation first.

Repository:

```
D:/AI Team/AI_Applications
```

Read:

* docs/asset-ingestion/HANDOFF_CONTEXT.md
* docs/asset-ingestion/IMPLEMENTATION_PLAN.md

Understand every existing module before modifying anything.

The goal is to reuse as much implementation as possible.

---

# Existing Stack

Keep the existing stack.

* NestJS 11
* Prisma
* PostgreSQL
* PGVector
* AWS S3
* AWS SQS
* Redis
* Google Drive
* Sharp
* OpenAI
* Jest

Do NOT introduce new frameworks.

Do NOT introduce LangChain.

Do NOT introduce unnecessary abstractions.

---

# New Architecture

Replace

```
Image
    ↓
Gemini Vision
    ↓
Metadata
    ↓
OpenAI Embedding
```

with

```
Image
    ↓
Image Embedding
    ↓
PGVector
```

No caption generation.

No keyword generation.

No AI metadata.

No Gemini Vision.

---

# Metadata Strategy

Our Drive folders are already manually organized.

Example:

```
Animals/
    Wild Animals/
        Lion.png

Animals/
    Farm Animals/
        Cow.png

Alphabet/
    Letter A/
        Apple.png

Worksheets/
    Day/
        Sun.png
```

We will NOT extract category hierarchy into multiple database columns.

The folder depth is inconsistent across the Drive.

Some folders have

```
Parent
```

Some have

```
Parent/Child
```

Some have

```
Parent/Child/SubChild
```

Therefore:

Store only

```
folderPath
```

Example

```
Animals/Wild Animals
```

or

```
Alphabet/Letter A
```

or

```
Worksheets/Day
```

Do NOT create

```
category

subcategory

subsubcategory
```

columns.

Store the complete relative folder path exactly as discovered.

Also store

```
imageName
```

without extension.

Example

```
Elephant Walking
```

---

# Metadata to Persist

Store only deterministic metadata.

Required:

* Asset ID
* SHA256
* Folder Path
* Image Name
* Original Filename
* MIME Type
* Width
* Height
* File Size
* S3 URL
* Embedding Vector
* Created Time
* Updated Time

Do NOT store

* AI captions
* AI keywords
* AI objects
* AI colors
* AI descriptions
* Educational tags
* Age groups

Those are removed.

---

# Ingestion Flow

The new ingestion pipeline becomes

```
Drive Scan

↓

Download

↓

Validate

↓

Hash

↓

Extract folderPath

↓

Extract imageName

↓

Upload Original Image to S3

↓

Generate Image Embedding

↓

Store Asset

↓

Store Vector

↓

Completed
```

No metadata queue.

No Gemini queue.

---

# Queue Refactor

Current

```
ingestion

↓

s3

↓

metadata

↓

embedding
```

becomes

```
ingestion

↓

s3

↓

imageEmbedding
```

Remove metadata stage completely.

Update retry logic accordingly.

Update DLQ replay accordingly.

Update worker routing.

---

# Database Refactor

Remove tables that exist only for AI metadata.

If existing tables are shared elsewhere, mark them deprecated instead of deleting immediately.

Update Prisma schema.

Generate migration.

Preserve data integrity.

Do not break Asset relationships.

---

# Embedding Strategy

Research and recommend the best production-ready multimodal embedding model.

Requirements:

* Image → Embedding
* Text → Embedding
* Shared vector space
* Commercial usage
* Stable API
* Good semantic retrieval
* Reasonable pricing
* Works well with educational assets

Do NOT assume OpenAI is automatically the best choice.

Compare available providers and recommend one based on quality, cost, and long-term maintainability.

---

# Search API

The search API must become

```
Text Query

↓

Text Embedding

↓

PGVector cosine similarity

↓

Top K

↓

Return Asset Metadata
```

Returned object should include

* Asset ID
* Image Name
* Folder Path
* S3 URL
* Similarity Score

Support

```
topK

minimum similarity

pagination
```

Keep Redis cache.

---

# Folder Metadata Usage

The folder path is valuable metadata.

Do NOT embed only the filename.

When generating the searchable representation, consider using both:

```
folderPath

+

imageName
```

Example

```
Animals/Wild Animals

+

Elephant Walking
```

This improves semantic context while avoiding AI-generated metadata.

---

# Duplicate Handling

Keep existing SHA256 duplicate detection.

If duplicate

Skip

* Upload
* Embedding

Reuse existing asset.

---

# Existing Functionality To Preserve

Do NOT break

* Drive ingestion
* S3 upload
* Duplicate detection
* Redis
* PGVector
* Queue workers
* Retry
* DLQ
* Metrics
* Logging
* Validation scripts
* Integration tests

Reuse existing implementations wherever possible.

---

# Validation

Update validation scripts.

Remove

```
validate:vision
```

Replace with

```
validate:image-embedding
```

Update documentation.

Update validation report.

---

# Documentation

Update

IMPLEMENTATION_PLAN.md

HANDOFF_CONTEXT.md

COMPONENT_VALIDATION_REPORT.md

Architecture diagrams

Pipeline diagrams

Sequence diagrams

Queue diagrams

Database diagrams

to reflect the new architecture.

---

# Deliverables

Implement this work incrementally.

Before modifying any code:

1. Audit every affected module.
2. Produce a dependency impact report.
3. Produce a migration plan.
4. List every file that will change.
5. Explain any breaking changes.
6. Wait for approval before beginning implementation.

After approval, execute one task at a time, keeping the project in a buildable and testable state after every completed task.

Do not perform unnecessary refactoring.

Reuse existing modules wherever possible.

Minimize risk.

Preserve production readiness.

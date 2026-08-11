# Prompt: Implement a Pluggable Pipeline Execution Tracker

You are acting as a Principal Software Architect and Senior Backend Engineer.

## Objective

Implement a **lightweight, pluggable Pipeline Execution Tracker** for the Flashcard Generation workflow.

This tracker is **strictly for observability and debugging**.

It **must not** change any existing business logic.

It **must not** become a dependency of the workflow.

The workflow should continue functioning even if the tracker is completely removed.

The tracker should behave like middleware/interceptors/events rather than business logic.

---

# Core Design Principles

Follow these principles strictly:

* Zero business logic.
* Zero workflow ownership.
* No orchestration responsibilities.
* No decision making.
* No retries.
* No validation.
* No AI logic.
* No image search logic.

Its only responsibility is recording execution state.

If the tracker is disabled or removed, the Flashcard Generation workflow must continue to function without any code changes other than removing the module registration.

---

# Architecture

The tracker should be implemented as an independent NestJS module.

Example:

```text
modules/
    pipeline-tracker/
        pipeline-tracker.module.ts
        pipeline-tracker.service.ts
        pipeline-tracker.repository.ts
        pipeline-tracker.interceptor.ts
        pipeline-tracker.events.ts
```

Nothing inside the Flashcard module should depend directly on the tracker implementation.

The tracker should expose a small interface only.

Example:

```ts
tracker.startStage(...)

tracker.completeStage(...)

tracker.failStage(...)

tracker.recordEvent(...)
```

If the tracker is disabled, these methods should become no-ops.

---

# Configuration

The entire tracker should be controlled by a single configuration.

Example:

```env
PIPELINE_TRACKING_ENABLED=true
```

When disabled:

* no database writes
* no metrics
* no traces
* no request logging
* no response logging

The application should behave exactly as if the tracker never existed.

---

# Tracking Model

Every Generate Flashcard request should create one Pipeline Execution.

Each execution contains multiple Stage Executions.

Stages should be generic and reusable.

Example stages:

Request Validation

Age Identification

Learning Objective Selection

Template Selection

Prompt Generation

LLM Request

LLM Response Validation

Image Search

Image Mapping

Response Assembly

Response Validation

Completed

Failed

Do not hardcode these names.

Stages should be configurable.

---

# Stage Lifecycle

Every stage should support:

Pending

Running

Completed

Failed

Skipped

Cancelled

Each stage should store:

* stage name
* execution id
* sequence
* status
* start time
* end time
* duration
* retry count
* metadata

---

# Request Tracking

Every pipeline execution should include:

Execution Id

Request Id

Correlation Id

Workflow Type

Current Stage

Started At

Completed At

Status

Total Duration

The Request Id should remain consistent across the entire workflow.

---

# AI Invocation Tracking

Every AI call should create an invocation record.

Capture:

Provider

Model

Purpose

Started At

Completed At

Duration

Retry Count

Status

Prompt Hash

Response Hash

Token Usage (if available)

Cost (if available)

Do NOT store full prompts or responses by default.

Instead:

Store hashes.

Allow optional payload storage through configuration.

Example:

```env
PIPELINE_STORE_AI_PAYLOAD=false
```

---

# Asset Search Tracking

Track every image search.

Capture:

Search Query

Filters

Duration

Result Count

Selected Asset

Cache Hit

Search Failure

Do not store entire search results.

Only store summary information.

---

# Event-Based Design

The tracker should listen to events instead of being tightly coupled.

Example events:

PipelineStarted

StageStarted

StageCompleted

StageFailed

AiInvocationStarted

AiInvocationCompleted

ImageSearchStarted

ImageSearchCompleted

PipelineCompleted

PipelineFailed

The Flashcard module should emit events.

The tracker consumes them.

This keeps the workflow independent.

---

# Database

Design lightweight tables.

PipelineExecution

PipelineStageExecution

AiInvocation

ImageSearchExecution

Do not duplicate business data.

Store only tracking information.

---

# Metrics

Track:

Pipeline Duration

Stage Duration

Average LLM Time

Average Image Search Time

Retry Count

Failure Count

Concurrent Executions

AI Calls

Image Searches

Template Usage

These metrics should be optional.

---

# OpenTelemetry Integration

If OpenTelemetry exists:

Attach Execution Id and Correlation Id to the active trace.

If it does not exist:

Continue operating normally.

OpenTelemetry must be optional.

---

# Sentry Integration

If Sentry exists:

Attach:

Execution Id

Stage

Request Id

Template Id

Age Group

Topic

If Sentry is absent:

Continue normally.

No direct dependency.

---

# Logging

Use structured logging.

Every log entry should include:

Execution Id

Request Id

Correlation Id

Stage

Duration

Status

Avoid console.log.

---

# Performance

The tracker must never noticeably slow down the workflow.

Database writes should be lightweight.

Long-running persistence should be asynchronous where appropriate.

The tracker should never block AI calls.

---

# Error Handling

Tracker failures must never fail the workflow.

If tracking fails:

* log internally
* continue execution

Never throw tracker exceptions into business logic.

---

# Extensibility

The tracker should work with:

Flashcards

Worksheets

Books

Quizzes

Certificates

without modification.

Workflow type should be configurable.

---

# Removal Requirements

The tracker must be removable in under five minutes.

Removing:

PipelineTrackerModule

configuration

database tables

should completely remove tracking.

No changes should be required inside:

Flashcard Service

Template Engine

LLM Service

Image Search Service

Rendering Engine

Business logic should remain untouched.

---

# Deliverables

Produce:

1. Module architecture
2. Interfaces
3. Event definitions
4. Database schema
5. Configuration model
6. Repository layer
7. Service layer
8. Event listeners
9. OpenTelemetry integration (optional)
10. Sentry integration (optional)
11. Logging strategy
12. Metrics strategy
13. Removal strategy
14. Unit tests
15. Integration tests

The final implementation must follow a plugin-style architecture where the Pipeline Execution Tracker is an optional observability module that can be enabled, disabled, or completely removed without affecting the Flashcard Generation workflow or any business logic.

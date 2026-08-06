# Playwright Rendering Engine Alignment Tasks

- [x] Update `flashcard.interfaces.ts` and `template-layout.util.ts` to support styling attributes on layout regions.
- [x] Update `render-result.interface.ts` and `flashcard-renderer.service.ts` to include template and request metadata in `FlashcardRenderContext`.
- [x] Add `layout-root` and `layout-region` layout engine styles to `flashcard.css`.
- [x] Update `component-renderers.ts` with overlay support, custom text class long rules, options rendering, and image collections.
- [x] Refactor `component.renderer.ts` to resolve CSS classes dynamically based on component ID and type.
- [x] Refactor `region.renderer.ts` to support inline styling, fallback subject generation, and dynamic logo mapping.
- [x] Refactor `card.renderer.ts` to implement layout types and aligned theme selection logic.
- [x] Verify execution using existing tests and add new tests for card rendering.

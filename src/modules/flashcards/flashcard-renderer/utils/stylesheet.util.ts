import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let cachedCss: string | null = null;

export function loadFlashcardStylesheet(): string {
  if (cachedCss) {
    return cachedCss;
  }

  const candidates = [
    join(__dirname, '..', 'styles', 'flashcard.css'),
    join(
      process.cwd(),
      'src',
      'modules',
      'flashcards',
      'flashcard-renderer',
      'styles',
      'flashcard.css',
    ),
    join(
      process.cwd(),
      'dist',
      'modules',
      'flashcards',
      'flashcard-renderer',
      'styles',
      'flashcard.css',
    ),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cachedCss = readFileSync(candidate, 'utf8');
      return cachedCss;
    }
  }

  throw new Error('flashcard.css stylesheet could not be located');
}

export function clearFlashcardStylesheetCache(): void {
  cachedCss = null;
}

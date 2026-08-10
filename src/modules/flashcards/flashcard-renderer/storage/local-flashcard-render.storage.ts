import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import {
  FlashcardRenderStorageBackend,
  SaveRenderFileInput,
  StoredRenderFile,
} from './flashcard-render-storage.interface';

export class LocalFlashcardRenderStorage implements FlashcardRenderStorageBackend {
  readonly type = 'local' as const;
  private readonly storageRoot: string;

  constructor(private readonly configService: ConfigService) {
    this.storageRoot =
      this.configService.get<string>('flashcards.renderer.storageRoot') ??
      'storage/flashcards';
  }

  resolveOutputLocation(requestId: string): string {
    return join(this.storageRoot, requestId).replace(/\\/g, '/');
  }

  async saveFile(input: SaveRenderFileInput): Promise<StoredRenderFile> {
    const absolutePath = join(
      process.cwd(),
      this.storageRoot,
      input.requestId,
      input.fileName,
    );

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, input.buffer);

    const relativePath = join(this.storageRoot, input.requestId, input.fileName).replace(
      /\\/g,
      '/',
    );

    return {
      fileName: input.fileName,
      path: relativePath,
      uri: relativePath,
    };
  }
}

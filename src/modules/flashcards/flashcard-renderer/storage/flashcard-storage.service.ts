import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FlashcardStorageService {
  private readonly storageRoot: string;

  constructor(private readonly configService: ConfigService) {
    this.storageRoot =
      this.configService.get<string>('flashcards.renderer.storageRoot') ??
      'storage/flashcards';
  }

  resolveRequestDirectory(requestId: string): string {
    return join(process.cwd(), this.storageRoot, requestId);
  }

  async ensureRequestDirectory(requestId: string): Promise<string> {
    const directory = this.resolveRequestDirectory(requestId);
    await mkdir(directory, { recursive: true });
    return directory;
  }

  async writeBinaryFile(absolutePath: string, data: Buffer): Promise<void> {
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, data);
  }

  toRelativePath(absolutePath: string): string {
    const cwd = process.cwd();
    if (absolutePath.startsWith(cwd)) {
      return absolutePath.slice(cwd.length + 1).replace(/\\/g, '/');
    }

    return absolutePath.replace(/\\/g, '/');
  }
}

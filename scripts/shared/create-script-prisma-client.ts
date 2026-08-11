import { config } from 'dotenv';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@generated/prisma/client';

/** Load `.env` from the repo root for ts-node scripts. */
export function loadEnvFromProjectRoot(): void {
  config({ path: resolve(__dirname, '../../.env') });
}

/**
 * Prisma 7 requires a driver adapter — mirror `PrismaService` construction
 * for standalone scripts instead of `new PrismaClient()`.
 */
export function createScriptPrismaClient(): PrismaClient {
  loadEnvFromProjectRoot();

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Add it to .env or export it before running this script.',
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

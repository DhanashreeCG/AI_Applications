import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { INestApplicationContext } from '@nestjs/common';
import { AppModule } from '../../../src/app.module';

export async function createValidationContext(): Promise<INestApplicationContext> {
  process.env.SQS_WORKER_ENABLED = 'false';

  return NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
}

export function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) {
    return direct.slice(prefix.length);
  }

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }

  return undefined;
}

export function printResult(result: unknown): void {
  console.log(JSON.stringify(result, null, 2));
}

export async function runValidation(
  runner: (app: INestApplicationContext) => Promise<unknown>,
): Promise<void> {
  const app = await createValidationContext();

  try {
    const result = await runner(app);
    printResult({ status: 'success', result });
  } catch (error) {
    printResult({
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

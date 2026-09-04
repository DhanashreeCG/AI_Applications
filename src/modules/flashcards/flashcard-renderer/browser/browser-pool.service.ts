import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Browser, chromium } from 'playwright';

@Injectable()
export class BrowserPoolService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BrowserPoolService.name);
  private readonly enabled: boolean;
  private readonly executablePath?: string;
  private browser: Browser | null = null;
  private launchPromise: Promise<Browser> | null = null;

  constructor(private readonly configService: ConfigService) {
    this.enabled =
      this.configService.get<boolean>('flashcards.renderer.enabled') !== false ||
      this.configService.get<boolean>('worksheets.renderer.enabled') !== false;
    this.executablePath =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('Playwright renderer disabled; skipping browser launch');
      return;
    }

    try {
      await this.getBrowser();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Playwright failed to launch at startup; API will start without a browser. ${message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
      this.launchPromise = null;
      this.logger.log('Playwright browser closed');
    }
  }

  async getBrowser(): Promise<Browser> {
    if (!this.enabled) {
      throw new ServiceUnavailableException('Playwright renderer is disabled');
    }

    if (this.browser?.isConnected()) {
      return this.browser;
    }

    if (!this.launchPromise) {
      this.launchPromise = chromium
        .launch({
          headless: true,
          executablePath: this.executablePath,
          args: [
            '--font-render-hinting=none',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
          ],
        })
        .then((browser) => {
          this.browser = browser;
          this.logger.log('Playwright browser launched');
          return browser;
        })
        .catch((error) => {
          this.launchPromise = null;
          throw this.toLaunchError(error);
        });
    }

    return this.launchPromise;
  }

  private toLaunchError(error: unknown): ServiceUnavailableException {
    const message = error instanceof Error ? error.message : String(error);
    const missingLib = /cannot open shared object file|libatk|shared libraries/i.test(
      message,
    );

    if (missingLib) {
      return new ServiceUnavailableException(
        'Playwright Chromium is missing OS libraries (e.g. libatk-1.0.so.0). On the server run: npx playwright install-deps chromium',
      );
    }

    return new ServiceUnavailableException(
      `Playwright browser is unavailable: ${message}`,
    );
  }
}

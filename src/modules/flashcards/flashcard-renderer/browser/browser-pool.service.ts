import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Browser, chromium } from 'playwright';

@Injectable()
export class BrowserPoolService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BrowserPoolService.name);
  private browser: Browser | null = null;
  private launchPromise: Promise<Browser> | null = null;

  async onModuleInit(): Promise<void> {
    await this.getBrowser();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.launchPromise = null;
      this.logger.log('Playwright browser closed');
    }
  }

  async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) {
      return this.browser;
    }

    if (!this.launchPromise) {
      this.launchPromise = chromium
        .launch({
          headless: true,
          args: ['--font-render-hinting=none'],
        })
        .then((browser) => {
          this.browser = browser;
          this.logger.log('Playwright browser launched');
          return browser;
        })
        .catch((error) => {
          this.launchPromise = null;
          throw error;
        });
    }

    return this.launchPromise;
  }
}

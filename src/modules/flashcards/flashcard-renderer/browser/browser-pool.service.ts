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
  private browser: Browser | null = null;
  private launchPromise: Promise<Browser> | null = null;

  constructor(private readonly configService: ConfigService) {
    this.enabled = true;
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('Playwright renderer disabled; skipping browser launch');
      return;
    }
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

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { LoggingInterceptor } from './modules/observability/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalInterceptors(app.get(LoggingInterceptor));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();

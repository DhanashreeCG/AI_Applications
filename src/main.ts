import { join } from 'node:path';
import { json, urlencoded } from 'express';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { LoggingInterceptor } from './modules/observability/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const port = process.env.PORT ?? 5000;
  app.use(json({ limit: '20mb' }));
  app.use(urlencoded({ extended: true, limit: '20mb' }));
  app.useGlobalInterceptors(app.get(LoggingInterceptor));
  app.enableCors();
  app.useStaticAssets(join(process.cwd(), 'public'), {
    setHeaders: (res) => {
      res.set('Access-Control-Allow-Origin', '*');
    },
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('AI Asset Ingestion API')
    .setDescription('REST API listing (minimal docs)')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);

  await app.listen(port);
  console.log(`Server is running on http://localhost:${port}`);
}
bootstrap();

import { join } from 'node:path';
import { json, urlencoded } from 'express';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { buildCorsOptions } from './common/http/cors.util';
import { AppModule } from './app.module';
import { LoggingInterceptor } from './modules/observability/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  const port = configService.get<number>('port') ?? Number(process.env.PORT ?? 5000);
  const cors = configService.get<{
    origins: string[];
    allowAll: boolean;
    credentials: boolean;
  }>('cors') ?? { origins: [], allowAll: true, credentials: false };

  app.use(json({ limit: '20mb' }));
  app.use(urlencoded({ extended: true, limit: '20mb' }));
  app.useGlobalInterceptors(app.get(LoggingInterceptor));
  app.enableCors(buildCorsOptions(cors));
  app.useStaticAssets(join(process.cwd(), 'public'), {
    setHeaders: (res) => {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
      res.set('Cross-Origin-Resource-Policy', 'cross-origin');
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

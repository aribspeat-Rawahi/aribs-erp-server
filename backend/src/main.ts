import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS;
  app.enableCors({
    origin: allowedOrigins ? allowedOrigins.split(',').map((o) => o.trim()) : '*',
  });
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`ERP backend running on port ${port}`);
}
bootstrap();

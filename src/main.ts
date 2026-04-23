import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { LogLevel } from '@nestjs/common';
import { AppModule } from './app.module';

const ALL_LOG_LEVELS: readonly LogLevel[] = [
  'fatal',
  'error',
  'warn',
  'log',
  'debug',
  'verbose',
];

function parseLogLevels(raw: string | undefined): LogLevel[] {
  if (!raw) {
    return ['log', 'warn', 'error', 'fatal'];
  }

  const allowed = new Set<LogLevel>(ALL_LOG_LEVELS);
  const parsed = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is LogLevel => allowed.has(entry as LogLevel));

  return parsed.length > 0 ? parsed : ['log', 'warn', 'error', 'fatal'];
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: parseLogLevels(process.env.LOG_LEVELS),
  });
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  const port = Number(configService.get<string>('PORT', '3000'));
  await app.listen(port);
}
void bootstrap();

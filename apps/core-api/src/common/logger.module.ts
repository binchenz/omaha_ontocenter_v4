import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';

@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        genReqId: () => randomUUID(),
        transport: process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
          : undefined,
        level: process.env.LOG_LEVEL ?? 'info',
        serializers: {
          req: (req) => ({ method: req.method, url: req.url, traceId: req.id }),
          res: (res) => ({ statusCode: res.statusCode }),
        },
        redact: ['req.headers.authorization'],
      },
    }),
  ],
})
export class LoggerModule {}

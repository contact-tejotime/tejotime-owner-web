import pino from 'pino';
import { env, isProd } from './env';

/**
 * Structured logger. PII (phones, tokens, passwords, OTP codes) is redacted
 * everywhere via the paths below — see docs/11-errors-logging.md §6.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.password_hash',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.code',
      '*.otp',
      '*.phone',
      '*.customerPhone',
      '*.customer_phone',
    ],
    censor: '[redacted]',
  },
  transport: isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
      },
});

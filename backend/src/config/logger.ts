import pino from 'pino';
import { env, isProd } from './env';

/**
 * Structured logger. PII (phones, tokens, passwords, OTP codes) is redacted
 * everywhere via the paths below — see docs/11-errors-logging.md §6.
 */
const options: pino.LoggerOptions = {
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
};

// Pretty logs in dev only, and only when pino-pretty is actually installed.
// It's a devDependency, so it's absent from production runtimes — guard against
// that so a missing pretty-printer degrades to JSON logs instead of crashing boot.
if (!isProd) {
  try {
    require.resolve('pino-pretty');
    options.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
    };
  } catch {
    // pino-pretty not available → structured JSON logging.
  }
}

export const logger = pino(options);

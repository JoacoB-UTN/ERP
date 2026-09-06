/**
 * Minimal leveled logger.
 *
 * The agent runs as a Windows service, so stdout/stderr are captured to a log
 * file by the service wrapper. Lines are kept single-line and prefixed with a
 * timestamp and level so support can grep them.
 *
 * Nothing that reaches this logger may contain a credential: the caller is
 * responsible for passing messages, never raw configuration objects.
 */

const LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LEVELS)[number];

export interface Logger {
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
}

export function createLogger(level: LogLevel): Logger {
  const threshold = LEVELS.indexOf(level);

  const emit = (messageLevel: LogLevel, message: string) => {
    if (LEVELS.indexOf(messageLevel) > threshold) return;
    const line = `${new Date().toISOString()} ${messageLevel.toUpperCase()} ${message}`;
    if (messageLevel === 'error' || messageLevel === 'warn') {
      console.error(line);
    } else {
      console.log(line);
    }
  };

  return {
    error: (message) => emit('error', message),
    warn: (message) => emit('warn', message),
    info: (message) => emit('info', message),
    debug: (message) => emit('debug', message),
  };
}

/**
 * Deliberately tiny — this is not `apps/api`'s pino setup, just enough
 * structure to be useful in a packaged app's log file. Never log
 * `access_token`/`refresh_token`/cookies/passwords — this module has no
 * access to any of those anyway (see "Session security" in
 * docs/desktop-lan-architecture.md: the desktop shell never reads the
 * session cookie), but callers must still avoid logging raw error
 * objects from fetches that could carry response bodies.
 */
export interface LogFields {
  [key: string]: string | number | boolean | undefined;
}

function write(level: 'info' | 'warn' | 'error', event: string, fields: LogFields = {}): void {
  const line = { ts: new Date().toISOString(), level, event, ...fields };
  const serialized = JSON.stringify(line);
  if (level === 'error') console.error(serialized);
  else if (level === 'warn') console.warn(serialized);
  else console.log(serialized);
}

export const logger = {
  info: (event: string, fields?: LogFields) => write('info', event, fields),
  warn: (event: string, fields?: LogFields) => write('warn', event, fields),
  error: (event: string, fields?: LogFields) => write('error', event, fields),
};

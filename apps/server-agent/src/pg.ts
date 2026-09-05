import { spawn } from 'node:child_process';
import path from 'node:path';

/**
 * Thin wrapper around the PostgreSQL command-line tools.
 *
 * The agent shells out to pg_dump/pg_restore rather than implementing a dump
 * format itself: they are the only tools guaranteed to produce an archive the
 * matching PostgreSQL server can actually restore, including extensions,
 * sequences and ownership.
 */

export interface PgConnection {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
}

/**
 * Derives connection parameters from a libpq-style URL.
 *
 * Kept separate from any process spawning so it can be unit-tested without a
 * database, and so the password never has to travel further than the object.
 */
export function parseDatabaseUrl(databaseUrl: string): PgConnection {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.');
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(`Unsupported DATABASE_URL protocol "${url.protocol}" (expected postgres:).`);
  }

  const database = url.pathname.replace(/^\//, '');
  if (!database) {
    throw new Error('DATABASE_URL does not name a database.');
  }

  if (!url.username) {
    throw new Error('DATABASE_URL does not include a user.');
  }

  return {
    host: url.hostname || 'localhost',
    port: url.port ? Number(url.port) : 5432,
    database,
    user: decodeURIComponent(url.username),
    password: url.password ? decodeURIComponent(url.password) : undefined,
  };
}

/** Resolves a tool name against the configured bin directory, falling back to PATH. */
export function resolvePgBinary(tool: string, binDir?: string): string {
  const executable = process.platform === 'win32' ? `${tool}.exe` : tool;
  return binDir ? path.join(binDir, executable) : executable;
}

export interface RunResult {
  code: number | null;
  stderr: string;
  stdout: string;
}

/**
 * Runs a PostgreSQL CLI tool.
 *
 * The password is passed through PGPASSWORD in the child environment, never as
 * a command-line argument: argv is readable by any other process on the machine
 * (Task Manager, `wmic process`), which would leak the database password to
 * every user of the server PC.
 */
export function runPgTool(
  binary: string,
  args: string[],
  connection: PgConnection,
  timeoutMs: number,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      env: {
        ...process.env,
        ...(connection.password ? { PGPASSWORD: connection.password } : {}),
      },
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (error.code === 'ENOENT') {
        reject(
          new Error(
            `Could not find "${binary}". Set ERP_PG_BIN_DIR to the PostgreSQL bin directory.`,
          ),
        );
        return;
      }
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`"${path.basename(binary)}" timed out after ${timeoutMs}ms.`));
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
}

/** Connection arguments shared by pg_dump and pg_restore. */
export function connectionArgs(connection: PgConnection): string[] {
  return [
    '--host',
    connection.host,
    '--port',
    String(connection.port),
    '--username',
    connection.user,
    '--no-password',
  ];
}

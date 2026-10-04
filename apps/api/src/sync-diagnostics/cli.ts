import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { analyzeCatalogs, renderMarkdown } from './analyzer';
import type { DiagnosticReport } from './analyzer';

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const USAGE =
  'Usage: node apps/api/dist/sync-diagnostics/cli.js --central <json> --local <json> [--mappings <json>] --output <new-directory>';

type Output = (message: string) => void;

function readJson(path: string): unknown {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) {
      throw new Error('Expected a regular JSON file of at most 10 MiB.');
    }
    const data = Buffer.alloc(MAX_INPUT_BYTES + 1);
    let length = 0;
    while (length < data.length) {
      const count = readSync(fd, data, length, data.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > MAX_INPUT_BYTES) {
      throw new Error('Input grew beyond the size limit.');
    }
    return JSON.parse(data.subarray(0, length).toString('utf8')) as unknown;
  } finally {
    closeSync(fd);
  }
}

function publishReports(directory: string, report: DiagnosticReport): void {
  // mkdir without recursive/overwrite is the exclusive claim. Existing files,
  // directories and symlinks are refused, including aliases of input paths.
  mkdirSync(directory, { mode: 0o700 });
  const created: string[] = [];
  try {
    const reports: [string, string][] = [
      ['report.json', `${JSON.stringify(report, null, 2)}\n`],
      ['report.md', renderMarkdown(report)],
    ];
    for (const [name, content] of reports) {
      const path = join(directory, name);
      const fd = openSync(path, 'wx', 0o600);
      created.push(path);
      try {
        writeFileSync(fd, content);
      } finally {
        closeSync(fd);
      }
    }
  } catch (error) {
    // Only remove paths this invocation created, never an existing output.
    for (const path of created) {
      try {
        unlinkSync(path);
      } catch {
        // A concurrent filesystem change must not broaden cleanup.
      }
    }
    try {
      rmdirSync(directory);
    } catch {
      // Leave any unrecognized contents intact.
    }
    throw error;
  }
}

export function runCli(
  args: string[],
  stdout: Output = (message) => process.stdout.write(`${message}\n`),
  stderr: Output = (message) => process.stderr.write(`${message}\n`),
): number {
  if (args.length === 1 && args[0] === '--help') {
    stdout(USAGE);
    return 0;
  }
  const options = new Map<string, string>();
  const allowed = new Set(['--central', '--local', '--mappings', '--output']);
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (
      !allowed.has(flag) ||
      options.has(flag) ||
      !value ||
      value.startsWith('--')
    ) {
      stderr(USAGE);
      return 4;
    }
    options.set(flag, value);
  }
  const centralPath = options.get('--central');
  const localPath = options.get('--local');
  const outputPath = options.get('--output');
  if (!centralPath || !localPath || !outputPath) {
    stderr(USAGE);
    return 4;
  }
  let central: unknown;
  let local: unknown;
  let mappings: unknown;
  try {
    central = readJson(centralPath);
    local = readJson(localPath);
    const mappingPath = options.get('--mappings');
    if (mappingPath) mappings = readJson(mappingPath);
  } catch {
    // Do not log parser messages, file contents or a caller's private paths.
    stderr('Cannot read input: use regular JSON files of at most 10 MiB each.');
    return 4;
  }

  const report = analyzeCatalogs(central, local, mappings);
  try {
    publishReports(resolve(outputPath), report);
  } catch {
    stderr(
      'Cannot write reports: choose a new directory in an existing writable parent.',
    );
    return 4;
  }
  stdout(`Diagnostic: ${report.status}. Reports: report.json and report.md.`);
  stdout(
    'Read-only assessment; no records were adopted and sync is not enabled.',
  );
  const exitCodes: Record<DiagnosticReport['status'], number> = {
    clear: 0,
    'review-required': 1,
    'invalid-input': 2,
    conflicts: 3,
  };
  return exitCodes[report.status];
}

if (require.main === module) {
  process.exitCode = runCli(process.argv.slice(2));
}

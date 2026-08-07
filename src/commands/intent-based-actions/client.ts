import { execSync } from 'node:child_process';
import {
  readFileSync,
  unlinkSync,
  mkdtempSync,
  existsSync,
  rmdirSync,
  statSync,
  accessSync,
  constants as fsConstants,
} from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';

let resolvedCliCommand: string | undefined;

function shellEscape(arg: string): string {
  if (/^[a-zA-Z0-9._:/-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

// Resolves "backstage-cli" by walking PATH ourselves (rather than shelling
// out to `which`), only trusting directories that aren't writable by
// group/other, so a tampered PATH entry can't cause us to resolve a
// malicious binary (see Sonar rule S4036: OS commands should not be
// searched for in PATH).
function findBackstageCliOnPath(): string | undefined {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const binName =
    process.platform === 'win32' ? 'backstage-cli.cmd' : 'backstage-cli';

  for (const dir of dirs) {
    try {
      // eslint-disable-next-line no-bitwise
      if ((statSync(dir).mode & 0o022) !== 0) continue;
    } catch {
      continue;
    }

    const candidate = join(dir, binName);
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}

function getBackstageCliCommand(): string {
  if (resolvedCliCommand) return resolvedCliCommand;

  const found = findBackstageCliOnPath();
  if (found) {
    resolvedCliCommand = shellEscape(found);
    return resolvedCliCommand;
  }

  resolvedCliCommand = 'NPM_CONFIG_LEGACY_PEER_DEPS=true npx -y @backstage/cli';
  return resolvedCliCommand;
}

export function execPassthrough(args: string[]): void {
  const cli = getBackstageCliCommand();
  const cmd = `${cli} ${args.map(shellEscape).join(' ')}`;
  try {
    execSync(cmd, {
      encoding: 'utf-8',
      stdio: 'inherit',
      timeout: 120_000,
    });
  } catch (error: any) {
    process.exit(error.status ?? 1);
  }
}

export async function execAction(
  actionId: string,
  flags: Record<string, string | boolean | number | undefined>,
): Promise<string> {
  const cli = getBackstageCliCommand();
  const parts = [cli, 'actions', 'execute', actionId];

  for (const [key, value] of Object.entries(flags)) {
    if (value === undefined || value === false) continue;
    parts.push(`--${key}`);
    if (value !== true) {
      parts.push(shellEscape(String(value)));
    }
  }

  const dir = mkdtempSync(join(tmpdir(), 'rhdh-cli-'));
  const outFile = join(dir, 'out.json');
  const errFile = join(dir, 'err.txt');

  const cleanup = () => {
    try {
      unlinkSync(outFile);
    } catch {
      // best-effort cleanup, ignore if already removed
    }
    try {
      unlinkSync(errFile);
    } catch {
      // best-effort cleanup, ignore if already removed
    }
    try {
      rmdirSync(dir);
    } catch {
      // best-effort cleanup, ignore if already removed
    }
  };

  try {
    execSync(
      `${parts.join(' ')} > ${shellEscape(outFile)} 2>${shellEscape(errFile)}`,
      {
        encoding: 'utf-8',
        timeout: 60_000,
        maxBuffer: 50 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    const result = readFileSync(outFile, 'utf-8');
    cleanup();
    return result;
  } catch {
    let errorMsg = 'backstage-cli command failed';
    if (existsSync(errFile)) {
      const stderr = readFileSync(errFile, 'utf-8').trim();
      if (stderr) {
        const lines = stderr.split('\n').filter(l => l.trim());
        const errorLine = lines.find(l => /^Error:/i.test(l.trim()));
        errorMsg = errorLine
          ? errorLine.replace(/^\s*Error:\s*/i, '').trim()
          : lines[lines.length - 1].trim();
      }
    }
    cleanup();
    throw new Error(errorMsg);
  }
}

export async function execActionJson(
  actionId: string,
  flags: Record<string, string | boolean | number | undefined>,
): Promise<unknown> {
  const raw = await execAction(actionId, flags);
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

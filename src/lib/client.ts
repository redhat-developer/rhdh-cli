import { execSync, spawnSync } from 'node:child_process';
import {
  readFileSync,
  unlinkSync,
  mkdtempSync,
  existsSync,
  rmdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let resolvedCliCommand: string | undefined;

function shellEscape(arg: string): string {
  if (/^[a-zA-Z0-9._:/-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function getBackstageCliCommand(): string {
  if (resolvedCliCommand) return resolvedCliCommand;

  const whichResult = spawnSync('which', ['backstage-cli'], {
    encoding: 'utf-8',
  });
  if (whichResult.status === 0) {
    resolvedCliCommand = 'backstage-cli';
    return resolvedCliCommand;
  }

  resolvedCliCommand =
    'NPM_CONFIG_LEGACY_PEER_DEPS=true npx -y @backstage/cli';
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
    } catch {}
    try {
      unlinkSync(errFile);
    } catch {}
    try {
      rmdirSync(dir);
    } catch {}
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

import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { CliAuth } from '@backstage/cli-node';

const resolvedCliBinaries = new Map<string, string>();

// Resolve the dedicated CLI module instead of the aggregate Backstage CLI. The
// aggregate CLI discovers modules from the consumer project's package.json,
// which emits a fallback warning when rhdh-cli is executed through npx.
function resolveCliModuleBinary(command: string): string {
  const cached = resolvedCliBinaries.get(command);
  if (cached) return cached;

  const moduleName = `@backstage/cli-module-${command}`;

  let pkgJsonPath: string;
  try {
    pkgJsonPath = require.resolve(`${moduleName}/package.json`);
  } catch {
    throw new Error(
      `Unable to locate the "${moduleName}" dependency. Try reinstalling ` +
        'dependencies (e.g. `yarn install`).',
    );
  }

  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as {
    bin?: string | Record<string, string>;
  };
  const relBin =
    typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[`cli-module-${command}`];
  if (!relBin) {
    throw new Error(
      `Unable to locate the CLI binary: the installed ${moduleName} package ` +
        'does not declare it.',
    );
  }

  const resolved = join(dirname(pkgJsonPath), relBin);
  resolvedCliBinaries.set(command, resolved);
  return resolved;
}

// Keeps output consistently branded as `rhdh-cli`.
const upstreamCliNames = [
  'backstage-cli',
  '@backstage/cli-module-actions',
  '@backstage/cli-module-auth',
];

function findUpstreamCliName(text: string) {
  return upstreamCliNames
    .map(name => ({ name, index: text.indexOf(name) }))
    .filter(({ index }) => index >= 0)
    .sort((a, b) => a.index - b.index)[0];
}

function rebrand(text: string): string {
  return text
    .replace(/backstage-cli/g, 'rhdh-cli')
    .replace(/@backstage\/cli-module-(?:actions|auth)/g, 'rhdh-cli');
}

// Rebrands output as it streams in, without buffering more than a couple
// characters at a time, so interactive commands still feel responsive.
function createRebrandingWriter(target: NodeJS.WritableStream) {
  let pending = '';

  function flushCompleteNames() {
    let match = findUpstreamCliName(pending);
    while (match) {
      target.write(`${pending.slice(0, match.index)}rhdh-cli`);
      pending = pending.slice(match.index + match.name.length);
      match = findUpstreamCliName(pending);
    }
  }

  return {
    write(chunk: Buffer | string) {
      pending += chunk.toString();
      flushCompleteNames();
      const retainedLength = Math.max(
        0,
        ...upstreamCliNames.flatMap(name =>
          Array.from(
            { length: name.length - 1 },
            (_, index) => index + 1,
          ).filter(length => pending.endsWith(name.slice(0, length))),
        ),
      );
      if (pending.length > retainedLength) {
        target.write(pending.slice(0, pending.length - retainedLength));
        pending = pending.slice(pending.length - retainedLength);
      }
    },
    end() {
      if (pending) target.write(rebrand(pending));
      pending = '';
    },
  };
}

export function execPassthrough(args: string[]): void {
  const command = args[0];
  if (command !== 'actions' && command !== 'auth') {
    throw new Error(`Unsupported pass-through command: ${command}`);
  }
  const bin = resolveCliModuleBinary(command);
  const child = spawn(process.execPath, [bin, ...args], {
    stdio: ['inherit', 'pipe', 'pipe'],
    timeout: 120_000,
  });

  const stdout = createRebrandingWriter(process.stdout);
  const stderr = createRebrandingWriter(process.stderr);
  child.stdout.on('data', (chunk: Buffer) => stdout.write(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.write(chunk));

  child.on('error', (error: NodeJS.ErrnoException) => {
    stdout.end();
    stderr.end();
    process.stderr.write(`Failed to launch CLI module: ${error.message}\n`);
    process.exit(1);
  });

  child.on('close', code => {
    stdout.end();
    stderr.end();
    process.exit(code ?? 1);
  });
}

export function execAction(
  actionId: string,
  flags: Record<string, string | boolean | number | undefined>,
): string {
  const bin = resolveCliModuleBinary('actions');
  const args = ['actions', 'execute', actionId];

  for (const [key, value] of Object.entries(flags)) {
    if (value === undefined || value === false) continue;
    args.push(`--${key}`);
    if (value !== true) {
      args.push(String(value));
    }
  }

  try {
    return execFileSync(process.execPath, [bin, ...args], {
      encoding: 'utf-8',
      timeout: 60_000,
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    let errorMsg = 'backstage-cli command failed';
    const stderrValue =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? (error as { stderr?: string | Buffer }).stderr
        : undefined;
    let stderr = '';
    if (Buffer.isBuffer(stderrValue)) {
      stderr = stderrValue.toString('utf-8').trim();
    } else if (typeof stderrValue === 'string') {
      stderr = stderrValue.trim();
    }
    if (stderr) {
      const lines = stderr.split('\n').filter(l => l.trim());
      const errorLine = lines.find(l => /^Error:/i.test(l.trim()));
      errorMsg = errorLine
        ? errorLine.replace(/^\s*Error:\s*/i, '').trim()
        : lines[lines.length - 1].trim();
    }
    throw new Error(rebrand(errorMsg));
  }
}

export function execActionJson(
  actionId: string,
  flags: Record<string, string | boolean | number | undefined>,
): unknown {
  const raw = execAction(actionId, flags);
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function triggerTechDocsBuild(
  entity: { namespace: string; kind: string; name: string },
  instance?: string,
): Promise<string> {
  const auth = await CliAuth.create({ instanceName: instance });
  const accessToken = await auth.getAccessToken();
  const path = [entity.namespace, entity.kind, entity.name]
    .map(encodeURIComponent)
    .join('/');
  const url = new URL(
    `/api/techdocs/sync/${path}`,
    auth.getBaseUrl(),
  ).toString();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await response.text();

  if (!response.ok) {
    const status = `${response.status} ${response.statusText}`.trim();
    throw new Error(
      `TechDocs build failed with ${status}${body ? `: ${body}` : ''}`,
    );
  }

  return body;
}

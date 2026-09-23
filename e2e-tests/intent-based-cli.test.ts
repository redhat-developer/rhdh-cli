import { exec as execCallback } from 'node:child_process';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { log, logSection, runCommand } from './support/plugin-export-build';

const exec = promisify(execCallback);

const TEST_TIMEOUT = 60 * 1000;
const rhdhCli = path.resolve(__dirname, '../bin/rhdh-cli');

/** Env var that enables live RHDH catalog checks. Auth must already be configured. */
const RHDH_CLI_E2E_URL = process.env.RHDH_CLI_E2E_URL;

async function runCli(
  args: string,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{
  stdout: string;
  stderr: string;
  code: number;
}> {
  try {
    const { stdout, stderr } = await exec(`"${rhdhCli}" ${args}`, {
      shell: true,
      maxBuffer: 10 * 1024 * 1024,
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
    });
    return { stdout, stderr, code: 0 };
  } catch (err: unknown) {
    const e = err as {
      code?: string | number;
      stdout?: string;
      stderr?: string;
    };
    const code =
      typeof e.code === 'number' ? e.code : Number.parseInt(String(e.code), 10);
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      code: Number.isFinite(code) ? code : 1,
    };
  }
}

describe('intent-based CLI help and error contracts', () => {
  jest.setTimeout(TEST_TIMEOUT);

  it('rhdh-cli --help mentions catalog/api/search/docs/template', async () => {
    logSection('rhdh-cli --help');
    const { stdout } = await runCommand(`"${rhdhCli}" --help`);
    log(stdout);

    for (const command of ['catalog', 'api', 'search', 'docs', 'template']) {
      expect(stdout).toContain(command);
    }
  });

  it('catalog --help exposes subcommands', async () => {
    const { stdout } = await runCommand(`"${rhdhCli}" catalog --help`);
    for (const sub of ['list', 'get', 'validate', 'register', 'unregister']) {
      expect(stdout).toContain(sub);
    }
  });

  it('search --help exposes filter/types flags', async () => {
    const { stdout } = await runCommand(`"${rhdhCli}" search --help`);
    expect(stdout).toMatch(/--types/);
    expect(stdout).toMatch(/--filter/);
  });

  it('template --help exposes execute and dry-run', async () => {
    const { stdout } = await runCommand(`"${rhdhCli}" template --help`);
    expect(stdout).toContain('execute');
    expect(stdout).toContain('dry-run');
  });

  it('catalog register without --location-url exits non-zero with Error on stderr', async () => {
    const result = await runCli('catalog register');
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/Error:/);
    expect(result.stderr).toMatch(/location-url/i);
  });

  it('unknown command exits non-zero with Error on stderr', async () => {
    const result = await runCli('not-a-real-command');
    expect(result.code).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toMatch(
      /error|unknown|invalid command/i,
    );
  });

  it('help still works from an empty temp dir with no package.json', async () => {
    const emptyDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rhdh-cli-intent-empty-'),
    );
    try {
      const { stdout, code } = await runCli('--help', { cwd: emptyDir });
      expect(code).toBe(0);
      expect(stdout).toContain('catalog');
    } finally {
      await fs.remove(emptyDir);
    }
  });
});

describe('intent-based CLI live RHDH (optional)', () => {
  jest.setTimeout(TEST_TIMEOUT);

  const maybeIt = RHDH_CLI_E2E_URL ? it : it.skip;

  maybeIt(
    'catalog list --output json --kind Component returns parseable JSON',
    async () => {
      logSection(
        `Live catalog list against RHDH_CLI_E2E_URL=${RHDH_CLI_E2E_URL}`,
      );
      log(
        'Requires auth already configured (rhdh-cli auth login). Skipped in CI when unset.',
      );

      const result = await runCli(
        'catalog list --output json --kind Component',
        {
          env: {
            // Prefer existing auth/instance config; URL documents the target.
            RHDH_CLI_E2E_URL,
          },
        },
      );

      expect(result.code).toBe(0);
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    },
  );
});

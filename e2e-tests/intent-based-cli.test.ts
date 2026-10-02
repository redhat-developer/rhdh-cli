import { exec as execCallback } from 'node:child_process';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { log, logSection } from './support/plugin-export-build';

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

  it('exposes intent commands and subcommand help offline', async () => {
    logSection('rhdh-cli --help / subcommand --help');

    const root = await runCli('--help');
    expect(root.code).toBe(0);
    for (const command of ['catalog', 'api', 'search', 'docs', 'template']) {
      expect(root.stdout).toContain(command);
    }

    const catalog = await runCli('catalog --help');
    expect(catalog.code).toBe(0);
    for (const sub of ['list', 'get', 'validate', 'register', 'unregister']) {
      expect(catalog.stdout).toContain(sub);
    }

    const search = await runCli('search --help');
    expect(search.code).toBe(0);
    expect(search.stdout).toMatch(/--types/);
    expect(search.stdout).toMatch(/--filter/);

    const template = await runCli('template --help');
    expect(template.code).toBe(0);
    expect(template.stdout).toContain('execute');
    expect(template.stdout).toContain('dry-run');
  });

  it('exits non-zero with Error for invalid usage', async () => {
    const missingFlag = await runCli('catalog register');
    expect(missingFlag.code).not.toBe(0);
    expect(missingFlag.stderr).toMatch(/Error:/);
    expect(missingFlag.stderr).toMatch(/location-url/i);

    const unknown = await runCli('not-a-real-command');
    expect(unknown.code).not.toBe(0);
    expect(`${unknown.stderr}${unknown.stdout}`).toMatch(
      /error|unknown|invalid command/i,
    );
  });

  it('help works from an empty temp dir with no package.json', async () => {
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

const describeLive = RHDH_CLI_E2E_URL ? describe : describe.skip;

describeLive('intent-based CLI live RHDH (optional)', () => {
  jest.setTimeout(TEST_TIMEOUT);

  it('catalog list --output json --kind Component returns parseable JSON', async () => {
    logSection(
      `Live catalog list against RHDH_CLI_E2E_URL=${RHDH_CLI_E2E_URL}`,
    );
    log(
      'Requires auth already configured (rhdh-cli auth login). Skipped in CI when unset.',
    );

    const result = await runCli('catalog list --output json --kind Component');

    expect(result.code).toBe(0);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });
});

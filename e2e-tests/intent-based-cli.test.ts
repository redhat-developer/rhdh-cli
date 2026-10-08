import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

import {
  log,
  logSection,
  runCommand,
  runExpectingFailure,
} from './support/plugin-export-build';

const TEST_TIMEOUT = 60 * 1000;
const rhdhCli = path.resolve(__dirname, '../bin/rhdh-cli');

/**
 * Named authenticated Backstage/RHDH instance (`rhdh-cli auth login --instance …`).
 * Gates the optional live suite and is passed through as `--instance`.
 */
const RHDH_CLI_E2E_INSTANCE = process.env.RHDH_CLI_E2E_INSTANCE;

describe('intent-based CLI help and error contracts', () => {
  jest.setTimeout(TEST_TIMEOUT);

  it('exposes intent commands and subcommand help offline', async () => {
    logSection('rhdh-cli --help / subcommand --help');

    const root = await runCommand(`"${rhdhCli}" --help`);
    for (const command of ['catalog', 'api', 'search', 'docs', 'template']) {
      expect(root.stdout).toContain(command);
    }

    const catalog = await runCommand(`"${rhdhCli}" catalog --help`);
    for (const sub of ['list', 'get', 'validate', 'register', 'unregister']) {
      expect(catalog.stdout).toContain(sub);
    }

    const api = await runCommand(`"${rhdhCli}" api --help`);
    expect(api.stdout).toContain('list');
    expect(api.stdout).toContain('get-spec');

    const search = await runCommand(`"${rhdhCli}" search --help`);
    expect(search.stdout).toMatch(/--types/);
    expect(search.stdout).toMatch(/--filter/);

    const docs = await runCommand(`"${rhdhCli}" docs --help`);
    for (const sub of ['search', 'list', 'get', 'coverage', 'build']) {
      expect(docs.stdout).toContain(sub);
    }

    const template = await runCommand(`"${rhdhCli}" template --help`);
    expect(template.stdout).toContain('execute');
    expect(template.stdout).toContain('dry-run');
  });

  it('exits non-zero with Error for invalid usage', async () => {
    const missingFlag = await runExpectingFailure(
      `"${rhdhCli}" catalog register`,
    );
    expect(`${missingFlag.stderr}${missingFlag.message}`).toMatch(/Error:/);
    expect(`${missingFlag.stderr}${missingFlag.message}`).toMatch(
      /location-url/i,
    );

    const unknown = await runExpectingFailure(
      `"${rhdhCli}" not-a-real-command`,
    );
    expect(`${unknown.stderr}${unknown.stdout}${unknown.message}`).toMatch(
      /error|unknown|invalid command/i,
    );
  });

  it('help works from an empty temp dir with no package.json', async () => {
    const emptyDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rhdh-cli-intent-empty-'),
    );
    try {
      const { stdout } = await runCommand(`"${rhdhCli}" --help`, {
        cwd: emptyDir,
      });
      expect(stdout).toContain('catalog');
    } finally {
      await fs.remove(emptyDir);
    }
  });
});

const describeLive = RHDH_CLI_E2E_INSTANCE ? describe : describe.skip;

describeLive('intent-based CLI live RHDH (optional)', () => {
  jest.setTimeout(TEST_TIMEOUT);

  it('catalog list --output json --kind Component returns parseable JSON', async () => {
    logSection(`Live catalog list against --instance ${RHDH_CLI_E2E_INSTANCE}`);
    log(
      'Requires auth already configured (rhdh-cli auth login --instance …). Skipped in CI when RHDH_CLI_E2E_INSTANCE is unset.',
    );

    const result = await runCommand(
      `"${rhdhCli}" catalog list --output json --kind Component --instance "${RHDH_CLI_E2E_INSTANCE}"`,
    );

    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });
});

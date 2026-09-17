import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

import { log, logSection, runCommand } from './support/plugin-export-build';

const TEST_TIMEOUT = 5 * 60 * 1000;
const rhdhCli = path.resolve(__dirname, '../bin/rhdh-cli');

/** Shared install + typecheck + build + export sequence for a generated project. */
async function buildAndExport(pluginDir: string): Promise<void> {
  log(`Installing generated project in ${pluginDir}`);
  await runCommand(
    'YARN_ENABLE_IMMUTABLE_INSTALLS=false YARN_ENABLE_SCRIPTS=false yarn install',
    { cwd: pluginDir },
  );

  log('Typechecking generated project');
  await runCommand('yarn tsc', { cwd: pluginDir });

  log('Building generated project');
  await runCommand('yarn build', { cwd: pluginDir });

  log('Exporting as a dynamic plugin');
  await runCommand(`"${rhdhCli}" plugin export`, { cwd: pluginDir });
}

describe('plugin new', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhdh-cli-plugin-new-'));

  jest.setTimeout(TEST_TIMEOUT);

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it('creates a frontend plugin that installs, typechecks, builds, and exports', async () => {
    const pluginDir = path.join(tmpDir, 'frontend-plugin');

    logSection('Generate frontend plugin');
    await runCommand(
      `"${rhdhCli}" plugin new example-plugin --type frontend --output "${pluginDir}" --rhdh-version 2.1.0`,
    );

    await buildAndExport(pluginDir);

    expect(fs.existsSync(path.join(pluginDir, 'dist'))).toBe(true);
    expect(fs.existsSync(path.join(pluginDir, 'dist-dynamic'))).toBe(true);
    expect(
      fs.existsSync(path.join(pluginDir, 'dist-dynamic', 'package.json')),
    ).toBe(true);
  });

  it('creates a backend plugin that installs, typechecks, builds, and exports', async () => {
    const pluginDir = path.join(tmpDir, 'backend-plugin');

    logSection('Generate backend plugin');
    await runCommand(
      `"${rhdhCli}" plugin new example-plugin --type backend --output "${pluginDir}" --rhdh-version 2.1.0`,
    );

    await buildAndExport(pluginDir);

    expect(fs.existsSync(path.join(pluginDir, 'dist'))).toBe(true);
    expect(fs.existsSync(path.join(pluginDir, 'dist-dynamic'))).toBe(true);
    expect(
      fs.existsSync(path.join(pluginDir, 'dist-dynamic', 'package.json')),
    ).toBe(true);
  });
});

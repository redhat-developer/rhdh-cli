import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

import { log, logSection, runCommand } from './support/plugin-export-build';

describe('create and build a frontend plugin', () => {
  const TEST_TIMEOUT = 5 * 60 * 1000;
  const rhdhCli = path.resolve(__dirname, '../bin/rhdh-cli');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhdh-cli-plugin-new-'));
  const pluginDir = path.join(tmpDir, 'example-plugin');

  jest.setTimeout(TEST_TIMEOUT);

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it('creates a project that installs, typechecks, and builds', async () => {
    logSection('Generate frontend plugin');
    await runCommand(
      `"${rhdhCli}" plugin new example-plugin --type frontend --output "${pluginDir}" --rhdh-version 2.1.0`,
    );

    log(`Installing generated project in ${pluginDir}`);
    await runCommand(
      'YARN_ENABLE_IMMUTABLE_INSTALLS=false YARN_ENABLE_SCRIPTS=false yarn install',
      {
        cwd: pluginDir,
      },
    );

    log('Typechecking generated project');
    await runCommand('yarn tsc', { cwd: pluginDir });

    log('Building generated project');
    await runCommand('yarn build', { cwd: pluginDir });

    expect(fs.existsSync(path.join(pluginDir, 'dist'))).toBe(true);
  });
});

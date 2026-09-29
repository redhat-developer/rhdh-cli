/**
 * End-to-end integration tests for `rhdh-cli plugin dev`.
 *
 * Environment variables:
 * - `E2E_RHDH_LOCAL_DIR`: Path to an existing RHDH Local checkout to test against.
 *   When set, the test uses that directory rather than the lightweight compose mock
 *   fixture, increases the Jest timeout to 10 minutes to accommodate full image
 *   pulls and startup, and avoids removing local volumes on cleanup.
 * - `CONTAINER_TOOL`: Override container tool ('docker' or 'podman') for testing.
 */

import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

import {
  log,
  logSection,
  runCommand,
  RunCommandOptions,
} from './support/plugin-export-build';
import {
  cleanupCompose,
  cleanupContainers,
  createRhdhLocalFixture,
  detectAvailableComposeToolsSync,
} from './support/rhdh-local-fixture';

const isRealRuntime = Boolean(process.env.E2E_RHDH_LOCAL_DIR);
const TEST_TIMEOUT = isRealRuntime ? 10 * 60 * 1000 : 5 * 60 * 1000;
const rhdhCli = path.resolve(__dirname, '../bin/rhdh-cli');
const availableTools = detectAvailableComposeToolsSync();
const describeWithCompose =
  availableTools.length > 0 ? describe : describe.skip;

async function runExpectingFailure(
  command: string,
  options: RunCommandOptions = {},
): Promise<{ stdout: string; stderr: string; message: string }> {
  let succeeded = false;
  let stdout = '';
  let caughtError: unknown;

  try {
    const res = await runCommand(command, options);
    succeeded = true;
    stdout = res.stdout;
  } catch (err: unknown) {
    caughtError = err;
  }

  if (succeeded) {
    throw new Error(
      `Command expected to fail, but succeeded with output: ${stdout}`,
    );
  }

  const e = (caughtError || {}) as {
    stdout?: string;
    stderr?: string;
    message?: string;
  };
  return {
    stdout: e?.stdout || '',
    stderr: e?.stderr || '',
    message: e?.message || '',
  };
}

describe('plugin dev', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhdh-cli-plugin-dev-'));
  const pluginDir = path.join(tmpDir, 'test-frontend-plugin');

  jest.setTimeout(TEST_TIMEOUT);

  beforeAll(async () => {
    logSection('Setup test plugin and detect container tools');
    log(`rhdh-cli: ${rhdhCli}`);
    log(`workspace: ${tmpDir}`);
    log(`Detected compose tools: ${availableTools.join(', ') || 'none'}`);

    if (process.env.CI && availableTools.length === 0) {
      throw new Error(
        'No compose-capable container engine (docker or podman) detected in CI environment. E2E container lifecycle tests must execute in CI.',
      );
    }

    // Generate, install, typecheck, and build one test frontend plugin for dev command tests
    log('Scaffolding test frontend plugin');
    await runCommand(
      `"${rhdhCli}" plugin new test-frontend-plugin --type frontend --output "${pluginDir}" --rhdh-version 2.1.0`,
    );

    log('Installing dependencies in test plugin');
    await runCommand(
      'YARN_ENABLE_IMMUTABLE_INSTALLS=false YARN_ENABLE_SCRIPTS=false yarn install',
      { cwd: pluginDir },
    );

    log('Generating TypeScript declarations in test plugin');
    await runCommand('yarn tsc', { cwd: pluginDir });

    log('Building test plugin');
    await runCommand('yarn build', { cwd: pluginDir });
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  describe('pre-flight validation and errors', () => {
    it('fails when --rhdh-local-dir is omitted and RHDH_LOCAL_DIR is not set', async () => {
      const { stderr, message } = await runExpectingFailure(
        `"${rhdhCli}" plugin dev start`,
        {
          cwd: pluginDir,
          env: { ...process.env, RHDH_LOCAL_DIR: '', E2E_RHDH_LOCAL_DIR: '' },
        },
      );
      const combined = stderr + message;
      expect(combined).toMatch(/Specify --rhdh-local-dir <directory>/);
    });

    it('fails when --rhdh-local-dir points to a non-existent directory', async () => {
      const missingDir = path.join(tmpDir, 'non-existent-dir');
      const { stderr, message } = await runExpectingFailure(
        `"${rhdhCli}" plugin dev start --rhdh-local-dir "${missingDir}"`,
        { cwd: pluginDir },
      );
      const combined = stderr + message;
      expect(combined).toMatch(/Missing required files/);
    });

    it('fails when --rhdh-local-dir points to an invalid directory missing required files', async () => {
      const invalidDir = path.join(tmpDir, 'invalid-rhdh-dir');
      await fs.ensureDir(invalidDir);
      const { stderr, message } = await runExpectingFailure(
        `"${rhdhCli}" plugin dev start --rhdh-local-dir "${invalidDir}"`,
        { cwd: pluginDir },
      );
      const combined = stderr + message;
      expect(combined).toMatch(/Missing required files: compose\.yaml/);
    });

    it('fails when dynamic-plugins.override.yaml is missing', async () => {
      const fixtureDir = path.join(tmpDir, 'fixture-no-override');
      const { runtimeDir } = await createRhdhLocalFixture(fixtureDir);
      await fs.remove(
        path.join(
          runtimeDir,
          'configs/dynamic-plugins/dynamic-plugins.override.yaml',
        ),
      );

      const { stderr, message } = await runExpectingFailure(
        `"${rhdhCli}" plugin dev start --rhdh-local-dir "${runtimeDir}"`,
        { cwd: pluginDir },
      );
      const combined = stderr + message;
      expect(combined).toMatch(/RHDH Local override configuration is missing/);
    });

    it('fails when dynamic-plugins.override.yaml does not include generated config and --configure is omitted', async () => {
      const fixtureDir = path.join(tmpDir, 'fixture-unconfigured');
      const { runtimeDir } = await createRhdhLocalFixture(fixtureDir);

      const { stderr, message } = await runExpectingFailure(
        `"${rhdhCli}" plugin dev start --rhdh-local-dir "${runtimeDir}"`,
        { cwd: pluginDir },
      );
      const combined = stderr + message;
      expect(combined).toMatch(
        /Add configs\/dynamic-plugins\/rhdh-cli\.generated\.local\.yaml to.*includes list/,
      );
      expect(combined).toMatch(/--configure/);
    });

    it('fails when --container-tool receives an invalid tool', async () => {
      const fixtureDir = path.join(tmpDir, 'fixture-invalid-tool');
      const { runtimeDir } = await createRhdhLocalFixture(fixtureDir);

      const { stderr, message } = await runExpectingFailure(
        `"${rhdhCli}" plugin dev start --rhdh-local-dir "${runtimeDir}" --container-tool invalid-tool`,
        { cwd: pluginDir },
      );
      const combined = stderr + message;
      expect(combined).toMatch(
        /Invalid value for --container-tool: invalid-tool/,
      );
    });

    it('fails fast on backend plugin when dist-types/ is missing', async () => {
      const backendDir = path.join(tmpDir, 'test-backend-no-dist-types');
      await fs.ensureDir(backendDir);
      await fs.writeJson(path.join(backendDir, 'package.json'), {
        name: 'test-backend-plugin',
        version: '0.1.0',
        backstage: { role: 'backend-plugin' },
      });

      const fixtureDir = path.join(tmpDir, 'fixture-backend-check');
      const { runtimeDir } = await createRhdhLocalFixture(fixtureDir);

      const { stderr, message } = await runExpectingFailure(
        `"${rhdhCli}" plugin dev start --rhdh-local-dir "${runtimeDir}" --configure`,
        { cwd: backendDir },
      );
      const combined = stderr + message;
      expect(combined).toMatch(
        /dist-types not found\. Run `yarn tsc` before using `plugin dev`/,
      );
    });
  });

  describeWithCompose('runtime not-running pre-flight checks', () => {
    it('fails fast on plugin dev update when RHDH Local runtime is not running', async () => {
      const fixtureDir = path.join(tmpDir, 'fixture-update-not-running');
      const { runtimeDir } = await createRhdhLocalFixture(fixtureDir);

      const toolToUse = availableTools[0];
      const { stderr, message } = await runExpectingFailure(
        `"${rhdhCli}" plugin dev update --rhdh-local-dir "${runtimeDir}" --container-tool "${toolToUse}"`,
        { cwd: pluginDir },
      );
      const combined = stderr + message;
      expect(combined).toMatch(
        /RHDH Local is not running\. Run `rhdh-cli plugin dev start` first\./,
      );
    });

    it('fails fast on plugin dev restart when RHDH Local runtime is not running', async () => {
      const fixtureDir = path.join(tmpDir, 'fixture-restart-not-running');
      const { runtimeDir } = await createRhdhLocalFixture(fixtureDir);

      const toolToUse = availableTools[0];
      const { stderr, message } = await runExpectingFailure(
        `"${rhdhCli}" plugin dev restart --rhdh-local-dir "${runtimeDir}" --container-tool "${toolToUse}"`,
        { cwd: pluginDir },
      );
      const combined = stderr + message;
      expect(combined).toMatch(
        /RHDH Local is not running\. Run `rhdh-cli plugin dev start` first\./,
      );
    });
  });

  describeWithCompose('real container lifecycle', () => {
    describe.each(availableTools)('with container tool %s', tool => {
      let fixtureDir: string;
      let runtimeDir: string;
      let runtimePort: number;

      beforeAll(async () => {
        const configuredRuntime = process.env.E2E_RHDH_LOCAL_DIR;
        if (configuredRuntime) {
          await cleanupContainers(tool);
          runtimeDir = path.resolve(configuredRuntime);
          runtimePort = 7007;
          log(
            `Using real RHDH Local directory for ${tool} test: ${runtimeDir}`,
          );
        } else {
          fixtureDir = path.join(tmpDir, `fixture-live-${tool}`);
          const fixture = await createRhdhLocalFixture(fixtureDir);
          runtimeDir = fixture.runtimeDir;
          runtimePort = fixture.port;
          log(
            `Live container test runtime for ${tool} initialized at ${runtimeDir} on port ${runtimePort}`,
          );
        }
      });

      afterAll(async () => {
        if (runtimeDir) {
          if (isRealRuntime) {
            await cleanupContainers(tool);
          } else {
            await cleanupCompose(tool, runtimeDir);
          }
        }
      });

      it('executes plugin dev start --configure, status, update, and stop lifecycle cleanly', async () => {
        logSection(`[${tool}] plugin dev start --configure`);
        const startResult = await runCommand(
          `"${rhdhCli}" plugin dev start --rhdh-local-dir "${runtimeDir}" --container-tool "${tool}" --configure`,
          { cwd: pluginDir },
        );
        const startOutput = startResult.stdout + startResult.stderr;
        expect(startOutput).toMatch(
          /\[1\/4\] Building and exporting plugin\.\.\./,
        );
        expect(startOutput).toMatch(
          /\[2\/4\] Starting RHDH Local runtime\.\.\./,
        );
        expect(startOutput).toMatch(
          /\[3\/4\] Installing dynamic plugins\.\.\./,
        );
        expect(startOutput).toMatch(
          /\[4\/4\] Waiting for RHDH to be ready\.\.\./,
        );
        expect(startOutput).toMatch(/RHDH is ready at http:\/\/localhost:/);

        // Verify configuration and staging files created during start
        const overrideFile = path.join(
          runtimeDir,
          'configs/dynamic-plugins/dynamic-plugins.override.yaml',
        );
        const overrideContent = await fs.readFile(overrideFile, 'utf8');
        expect(overrideContent).toMatch(
          /configs\/dynamic-plugins\/rhdh-cli\.generated\.local\.yaml/,
        );

        const pkg = await fs.readJson(path.join(pluginDir, 'package.json'));
        const stagedPluginName = (pkg.name as string)
          .replace(/^@/, '')
          .replace(/\//, '-');

        const generatedConfigFile = path.join(
          runtimeDir,
          'configs/dynamic-plugins/rhdh-cli.generated.local.yaml',
        );
        expect(await fs.pathExists(generatedConfigFile)).toBe(true);
        const generatedContent = await fs.readFile(generatedConfigFile, 'utf8');
        expect(generatedContent).toMatch(
          new RegExp(`package: "?\\./local-plugins/${stagedPluginName}"?`),
        );
        expect(generatedContent).toMatch(/enabled: true/);
        expect(generatedContent).toMatch(/pullPolicy: "?Always"?/);

        const stagedDir = path.join(
          runtimeDir,
          'local-plugins',
          stagedPluginName,
        );
        expect(await fs.pathExists(stagedDir)).toBe(true);
        expect(await fs.pathExists(path.join(stagedDir, 'package.json'))).toBe(
          true,
        );

        logSection(`[${tool}] plugin dev status`);
        const statusResult = await runCommand(
          `"${rhdhCli}" plugin dev status --rhdh-local-dir "${runtimeDir}" --container-tool "${tool}"`,
          { cwd: pluginDir },
        );
        const statusOutput = statusResult.stdout + statusResult.stderr;
        expect(statusOutput).toMatch(/RHDH Local is running/);

        logSection(`[${tool}] plugin dev update`);
        const updateResult = await runCommand(
          `"${rhdhCli}" plugin dev update --rhdh-local-dir "${runtimeDir}" --container-tool "${tool}"`,
          { cwd: pluginDir },
        );
        const updateOutput = updateResult.stdout + updateResult.stderr;
        expect(updateOutput).toMatch(
          /Refresh your browser at http:\/\/localhost:/,
        );

        logSection(`[${tool}] plugin dev stop --clean`);
        const stopResult = await runCommand(
          `"${rhdhCli}" plugin dev stop --rhdh-local-dir "${runtimeDir}" --container-tool "${tool}" --clean`,
          { cwd: pluginDir },
        );
        const stopOutput = stopResult.stdout + stopResult.stderr;
        expect(stopOutput).toMatch(/Stopped the RHDH Local runtime/);
        expect(stopOutput).not.toMatch(/(?:^|\n)\s*Error:/i);
        expect(stopOutput).not.toMatch(/Command '.*' exited with code/);

        // Verify status after stop reports not running or stopped
        const postStopStatus = await runCommand(
          `"${rhdhCli}" plugin dev status --rhdh-local-dir "${runtimeDir}" --container-tool "${tool}"`,
          { cwd: pluginDir },
        );
        const postStopOutput = postStopStatus.stdout + postStopStatus.stderr;
        expect(postStopOutput).toMatch(
          /RHDH Local is not running|RHDH Local stopped/,
        );
      });
    });
  });
});

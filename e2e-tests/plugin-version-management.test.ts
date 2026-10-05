/**
 * End-to-end integration tests for `rhdh-cli plugin check-versions` and `rhdh-cli plugin upgrade`.
 *
 * Verifies:
 * - Version drift and mismatch detection via `check-versions` (and alias `versions:lint`).
 * - Non-destructive `--dry-run` and `--skip-install` upgrade modes.
 * - Full dependency upgrade with lockfile synchronization.
 * - Multi-step release upgrade lifecycle (1.8 -> 2.0 -> 2.1).
 * - Clean post-upgrade validation and dynamic plugin export (`plugin export`).
 * - Air-gapped / offline auditing and upgrading via `--manifest-file` and `RHDH_OFFLINE=true`.
 */

import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

import {
  log,
  logSection,
  runCommand,
  runExpectingFailure,
} from './support/plugin-export-build';

const TEST_TIMEOUT = 8 * 60 * 1000;
const rhdhCli = path.resolve(__dirname, '../bin/rhdh-cli');

describe('plugin version management e2e', () => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rhdh-cli-e2e-ver-mgmt-'),
  );
  const pluginDir = path.join(tmpDir, 'test-plugin');

  jest.setTimeout(TEST_TIMEOUT);

  beforeAll(async () => {
    logSection('Setup real plugin fixture for version management e2e');
    log(`rhdh-cli: ${rhdhCli}`);
    log(`workspace: ${tmpDir}`);

    // Scaffold a standalone frontend plugin pinned to RHDH 2.1.0
    await runCommand(
      `"${rhdhCli}" plugin new test-plugin --type frontend --output "${pluginDir}" --rhdh-version 2.1.0`,
    );

    log('Installing baseline dependencies in test plugin');
    await runCommand(
      'YARN_ENABLE_IMMUTABLE_INSTALLS=false YARN_ENABLE_SCRIPTS=false yarn install',
      { cwd: pluginDir },
    );
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  describe('dependency auditing (rhdh-cli plugin check-versions)', () => {
    let originalPackageJson: Record<string, any>;
    let originalBackstageJson: Record<string, any>;

    beforeEach(async () => {
      originalPackageJson = await fs.readJson(
        path.join(pluginDir, 'package.json'),
      );
      originalBackstageJson = await fs.readJson(
        path.join(pluginDir, 'backstage.json'),
      );
    });

    afterEach(async () => {
      await fs.writeJson(
        path.join(pluginDir, 'package.json'),
        originalPackageJson,
        { spaces: 2 },
      );
      await fs.writeJson(
        path.join(pluginDir, 'backstage.json'),
        originalBackstageJson,
        { spaces: 2 },
      );
    });

    it('fails with exit code 1 when dependencies mismatch target RHDH release', async () => {
      // Intentionally drift @backstage/core-plugin-api to an earlier release version
      const pkg = await fs.readJson(path.join(pluginDir, 'package.json'));
      pkg.dependencies['@backstage/core-plugin-api'] = '^1.10.0';
      await fs.writeJson(path.join(pluginDir, 'package.json'), pkg, {
        spaces: 2,
      });

      // Human output mode
      const { stdout, stderr, message } = await runExpectingFailure(
        `"${rhdhCli}" plugin check-versions --rhdh-version 2.1.0`,
        { cwd: pluginDir },
      );
      const combined = stdout + stderr + message;
      expect(combined).toContain('mismatch');
      expect(combined).toContain('@backstage/core-plugin-api');
      expect(combined).toContain('rhdh-cli plugin upgrade 2.1.0');

      // JSON mode
      const jsonRes = await runExpectingFailure(
        `"${rhdhCli}" plugin check-versions --rhdh-version 2.1.0 --json`,
        { cwd: pluginDir },
      );
      const parsed = JSON.parse(jsonRes.stdout);
      expect(parsed.valid).toBe(false);
      expect(parsed.counts.mismatched).toBeGreaterThanOrEqual(1);

      const mismatchedPkg = parsed.packages.find(
        (p: { name: string }) => p.name === '@backstage/core-plugin-api',
      );
      expect(mismatchedPkg).toBeDefined();
      expect(mismatchedPkg.status).toBe('mismatch');
      expect(mismatchedPkg.declared).toBe('^1.10.0');
    });

    it('verifies alias plugin versions:lint behaves identically', async () => {
      const pkg = await fs.readJson(path.join(pluginDir, 'package.json'));
      pkg.dependencies['@backstage/core-plugin-api'] = '^1.10.0';
      await fs.writeJson(path.join(pluginDir, 'package.json'), pkg, {
        spaces: 2,
      });

      const { stdout, stderr, message } = await runExpectingFailure(
        `"${rhdhCli}" plugin versions:lint --rhdh-version 2.1.0`,
        { cwd: pluginDir },
      );
      const combined = stdout + stderr + message;
      expect(combined).toContain('mismatch');
      expect(combined).toContain('@backstage/core-plugin-api');
    });

    it('passes with exit code 0 when dependencies align with targeted release', async () => {
      const { stdout } = await runCommand(
        `"${rhdhCli}" plugin check-versions --rhdh-version 2.1.0 --json`,
        { cwd: pluginDir },
      );
      const parsed = JSON.parse(stdout);
      expect(parsed.valid).toBe(true);
      expect(parsed.counts.mismatched).toBe(0);
      expect(parsed.counts.matching).toBeGreaterThan(0);
    });
  });

  describe('dependency upgrading (rhdh-cli plugin upgrade)', () => {
    let baselinePackageJson: Record<string, any>;
    let baselineBackstageJson: Record<string, any>;

    beforeAll(async () => {
      baselinePackageJson = await fs.readJson(
        path.join(pluginDir, 'package.json'),
      );
      baselineBackstageJson = await fs.readJson(
        path.join(pluginDir, 'backstage.json'),
      );
    });

    beforeEach(async () => {
      // Introduce skew: older Backstage versions for RHDH 2.0.0
      const pkg = await fs.readJson(path.join(pluginDir, 'package.json'));
      pkg.dependencies['@backstage/core-plugin-api'] = '^1.12.7';
      pkg.dependencies['@backstage/core-components'] = '^0.18.11';
      await fs.writeJson(path.join(pluginDir, 'package.json'), pkg, {
        spaces: 2,
      });

      await fs.writeJson(
        path.join(pluginDir, 'backstage.json'),
        { version: '1.52.0' },
        { spaces: 2 },
      );
    });

    afterEach(async () => {
      await fs.writeJson(
        path.join(pluginDir, 'package.json'),
        baselinePackageJson,
        { spaces: 2 },
      );
      await fs.writeJson(
        path.join(pluginDir, 'backstage.json'),
        baselineBackstageJson,
        { spaces: 2 },
      );
    });

    it('--dry-run displays planned updates without modifying files on disk', async () => {
      const { stdout, stderr } = await runCommand(
        `"${rhdhCli}" plugin upgrade 2.1.0 --dry-run`,
        { cwd: pluginDir },
      );
      const combined = stdout + stderr;
      expect(combined).toContain('@backstage/core-plugin-api');
      expect(combined).toContain('package.json');

      // Verify files on disk remained untouched
      const currentPkg = await fs.readJson(
        path.join(pluginDir, 'package.json'),
      );
      expect(currentPkg.dependencies['@backstage/core-plugin-api']).toBe(
        '^1.12.7',
      );
      expect(currentPkg.dependencies['@backstage/core-components']).toBe(
        '^0.18.11',
      );

      const currentBackstageJson = await fs.readJson(
        path.join(pluginDir, 'backstage.json'),
      );
      expect(currentBackstageJson.version).toBe('1.52.0');
    });

    it('--skip-install modifies package.json and backstage.json without running install', async () => {
      const { stdout } = await runCommand(
        `"${rhdhCli}" plugin upgrade 2.1.0 --skip-install --json`,
        { cwd: pluginDir },
      );
      const parsed = JSON.parse(stdout);
      expect(parsed.installed).toBe(false);
      expect(parsed.updatedFiles).toContain('package.json');
      expect(parsed.updatedFiles).toContain('backstage.json');

      const currentPkg = await fs.readJson(
        path.join(pluginDir, 'package.json'),
      );
      expect(currentPkg.dependencies['@backstage/core-plugin-api']).not.toBe(
        '^1.12.7',
      );

      const currentBackstageJson = await fs.readJson(
        path.join(pluginDir, 'backstage.json'),
      );
      expect(currentBackstageJson.version).not.toBe('1.52.0');
    });

    it('performs full upgrade with package manager install and alias plugin versions:bump', async () => {
      log('Running full upgrade via alias plugin versions:bump');
      const { stdout, stderr } = await runCommand(
        `"${rhdhCli}" plugin versions:bump 2.1.0`,
        {
          cwd: pluginDir,
          env: { ...process.env, YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' },
        },
      );
      const combined = stdout + stderr;
      expect(combined).toContain('Successfully upgraded');

      const currentBackstageJson = await fs.readJson(
        path.join(pluginDir, 'backstage.json'),
      );
      expect(currentBackstageJson.version).not.toBe('1.52.0');
    });
  });

  describe('multi-step version upgrade lifecycle (1.8 -> 2.0 -> 2.1)', () => {
    const multiStepDir = path.join(tmpDir, 'multi-step-fixture');

    beforeAll(async () => {
      await fs.mkdirp(multiStepDir);
      // Simulate an older 1.8.0-era plugin package.json and backstage.json
      await fs.writeJson(
        path.join(multiStepDir, 'package.json'),
        {
          name: 'multi-step-fixture',
          version: '0.1.0',
          dependencies: {
            '@backstage/core-plugin-api': '^1.9.3',
            '@backstage/core-components': '^0.14.7',
            react: '^18.0.0',
          },
        },
        { spaces: 2 },
      );
      await fs.writeJson(
        path.join(multiStepDir, 'backstage.json'),
        { version: '1.42.5' },
        { spaces: 2 },
      );
    });

    it('steps through 1.8 -> 2.0 -> 2.1 upgrades cleanly', async () => {
      const offlineEnv = { ...process.env, RHDH_OFFLINE: 'true' };

      // 1. Audit against 2.0.0 detects mismatches
      const check20Pre = await runExpectingFailure(
        `"${rhdhCli}" plugin check-versions --rhdh-version 2.0.0 --json`,
        { cwd: multiStepDir, env: offlineEnv },
      );
      const check20PreJson = JSON.parse(check20Pre.stdout);
      expect(check20PreJson.valid).toBe(false);

      // 2. Upgrade to 2.0.0 (Backstage 1.52.0)
      const upgrade20 = await runCommand(
        `"${rhdhCli}" plugin upgrade 2.0.0 --skip-install --json`,
        { cwd: multiStepDir, env: offlineEnv },
      );
      const upgrade20Json = JSON.parse(upgrade20.stdout);
      expect(upgrade20Json.backstageVersion).toBe('1.52.0');

      const pkgAfter20 = await fs.readJson(
        path.join(multiStepDir, 'package.json'),
      );
      expect(pkgAfter20.dependencies['@backstage/core-plugin-api']).toBe(
        '^1.12.7',
      );
      // Third-party dependency remains untouched
      expect(pkgAfter20.dependencies.react).toBe('^18.0.0');

      const backstageAfter20 = await fs.readJson(
        path.join(multiStepDir, 'backstage.json'),
      );
      expect(backstageAfter20.version).toBe('1.52.0');

      // 3. Audit against 2.0.0 now passes cleanly
      const check20Post = await runCommand(
        `"${rhdhCli}" plugin check-versions --rhdh-version 2.0.0 --json`,
        { cwd: multiStepDir, env: offlineEnv },
      );
      expect(JSON.parse(check20Post.stdout).valid).toBe(true);

      // 4. Audit against 2.1.0 detects mismatches from 2.0.0
      const check21Pre = await runExpectingFailure(
        `"${rhdhCli}" plugin check-versions --rhdh-version 2.1.0 --json`,
        { cwd: multiStepDir, env: offlineEnv },
      );
      expect(JSON.parse(check21Pre.stdout).valid).toBe(false);

      // 5. Upgrade to 2.1.0 (Backstage 1.54.6 / 1.54.9)
      const upgrade21 = await runCommand(
        `"${rhdhCli}" plugin upgrade 2.1.0 --skip-install --json`,
        { cwd: multiStepDir, env: offlineEnv },
      );
      const upgrade21Json = JSON.parse(upgrade21.stdout);
      expect(upgrade21Json.updatedFiles).toContain('package.json');

      const pkgAfter21 = await fs.readJson(
        path.join(multiStepDir, 'package.json'),
      );
      expect(pkgAfter21.dependencies['@backstage/core-plugin-api']).not.toBe(
        '^1.12.7',
      );

      // 6. Audit against 2.1.0 now passes cleanly
      const check21Post = await runCommand(
        `"${rhdhCli}" plugin check-versions --rhdh-version 2.1.0 --json`,
        { cwd: multiStepDir, env: offlineEnv },
      );
      expect(JSON.parse(check21Post.stdout).valid).toBe(true);
    });
  });

  describe('post-upgrade build and dynamic export', () => {
    it('builds and exports successfully as a dynamic plugin without version conflicts', async () => {
      // Ensure pluginDir is aligned with 2.1.0
      await runCommand(`"${rhdhCli}" plugin upgrade 2.1.0 --skip-install`, {
        cwd: pluginDir,
      });

      const checkRes = await runCommand(
        `"${rhdhCli}" plugin check-versions --rhdh-version 2.1.0 --json`,
        { cwd: pluginDir },
      );
      expect(JSON.parse(checkRes.stdout).valid).toBe(true);

      log(
        'Typechecking and generating declarations in upgraded plugin project',
      );
      await runCommand('yarn tsc', { cwd: pluginDir });

      log('Building upgraded plugin project');
      await runCommand('yarn build', { cwd: pluginDir });

      log('Exporting upgraded dynamic plugin');
      await runCommand(`"${rhdhCli}" plugin export`, { cwd: pluginDir });

      expect(fs.existsSync(path.join(pluginDir, 'dist'))).toBe(true);
      expect(fs.existsSync(path.join(pluginDir, 'dist-dynamic'))).toBe(true);
      expect(
        fs.existsSync(path.join(pluginDir, 'dist-dynamic', 'package.json')),
      ).toBe(true);

      const exportedPkg = await fs.readJson(
        path.join(pluginDir, 'dist-dynamic', 'package.json'),
      );
      expect(exportedPkg.backstage?.['supported-versions']).toBeDefined();
    });
  });

  describe('air-gapped and offline execution', () => {
    const offlineDir = path.join(tmpDir, 'offline-fixture');
    const localManifestPath = path.join(offlineDir, 'local-manifest.json');

    beforeAll(async () => {
      await fs.mkdirp(offlineDir);

      // Local offline Backstage release manifest
      await fs.writeJson(
        localManifestPath,
        {
          releaseVersion: '1.54.6',
          packages: [
            { name: '@backstage/core-plugin-api', version: '1.12.9' },
            { name: '@backstage/core-components', version: '0.18.13' },
          ],
        },
        { spaces: 2 },
      );

      await fs.writeJson(
        path.join(offlineDir, 'package.json'),
        {
          name: 'offline-fixture',
          version: '0.1.0',
          dependencies: {
            '@backstage/core-plugin-api': '^1.10.0',
          },
        },
        { spaces: 2 },
      );

      await fs.writeJson(
        path.join(offlineDir, 'backstage.json'),
        { version: '1.50.0' },
        { spaces: 2 },
      );
    });

    it('audits and upgrades cleanly using --manifest-file and RHDH_OFFLINE=true', async () => {
      const offlineEnv = { ...process.env, RHDH_OFFLINE: 'true' };

      // 1. Audit detects mismatch without remote network calls
      const checkRes = await runExpectingFailure(
        `"${rhdhCli}" plugin check-versions --rhdh-version 2.1.0 --manifest-file "${localManifestPath}" --json`,
        { cwd: offlineDir, env: offlineEnv },
      );
      const parsedCheck = JSON.parse(checkRes.stdout);
      expect(parsedCheck.source).toBe('matrix');
      expect(parsedCheck.valid).toBe(false);

      // 2. Upgrade updates dependencies without network calls
      const upgradeRes = await runCommand(
        `"${rhdhCli}" plugin upgrade 2.1.0 --manifest-file "${localManifestPath}" --skip-install --json`,
        { cwd: offlineDir, env: offlineEnv },
      );
      const parsedUpgrade = JSON.parse(upgradeRes.stdout);
      expect(parsedUpgrade.source).toBe('matrix');
      expect(parsedUpgrade.changes[0].name).toBe('@backstage/core-plugin-api');
      expect(parsedUpgrade.changes[0].target).toBe('^1.12.9');
      expect(parsedUpgrade.updatedFiles).toContain('package.json');
      expect(parsedUpgrade.updatedFiles).toContain('backstage.json');

      const updatedBackstageJson = await fs.readJson(
        path.join(offlineDir, 'backstage.json'),
      );
      expect(updatedBackstageJson.version).toBe('1.54.6');

      // 3. Audit passes cleanly
      const recheckRes = await runCommand(
        `"${rhdhCli}" plugin check-versions --rhdh-version 2.1.0 --manifest-file "${localManifestPath}" --json`,
        { cwd: offlineDir, env: offlineEnv },
      );
      const parsedRecheck = JSON.parse(recheckRes.stdout);
      expect(parsedRecheck.valid).toBe(true);
      expect(parsedRecheck.counts.mismatched).toBe(0);
    });
  });
});

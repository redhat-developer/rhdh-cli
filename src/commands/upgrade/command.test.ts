/*
 * Copyright 2026 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'fs-extra';
import os from 'os';
import path from 'node:path';
import { resolveRhdhVersion } from '../../lib/rhdhVersion';
import * as runMod from '../../lib/run';
import {
  command,
  computeTargetVersion,
  detectPackageManager,
  upgradePluginDependencies,
} from './command';

jest.mock('../../lib/rhdhVersion', () => ({
  ...jest.requireActual('../../lib/rhdhVersion'),
  resolveRhdhVersion: jest.fn(),
}));

jest.mock('../../lib/run', () => ({
  ...jest.requireActual('../../lib/run'),
  runPlain: jest.fn(),
}));

describe('upgrade command', () => {
  let tmpDir: string;
  let originalCwd: string;
  const mockResolveRhdhVersion = resolveRhdhVersion as jest.MockedFunction<
    typeof resolveRhdhVersion
  >;
  const mockRunPlain = runMod.runPlain as jest.MockedFunction<
    typeof runMod.runPlain
  >;

  async function setupFixture(
    pkg: {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    },
    manifestPackages: [string, string][] = [
      ['@backstage/core-plugin-api', '1.12.0'],
      ['@backstage/cli', '0.36.3'],
      ['@backstage/config', '1.3.8'],
    ],
    backstageJsonVersion?: string,
  ) {
    await fs.writeJson(path.join(tmpDir, 'package.json'), {
      name: 'test-plugin',
      ...pkg,
    });

    if (backstageJsonVersion) {
      await fs.writeJson(path.join(tmpDir, 'backstage.json'), {
        version: backstageJsonVersion,
      });
    }

    mockResolveRhdhVersion.mockResolvedValue({
      rhdhVersion: '2.0.0',
      backstageVersion: '1.52.0',
      source: 'matrix',
      packages: new Map(manifestPackages),
    });
  }

  async function runCommandWithOutput(rhdhVersion?: string, opts: any = {}) {
    let stdout = '';
    let stderr = '';
    const stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: any) => {
        stdout += chunk;
        return true;
      });
    const stderrSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: any) => {
        stderr += chunk;
        return true;
      });

    try {
      await command(rhdhVersion, opts);
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }

    return { stdout, stderr };
  }

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'upgrade-test-'));
    process.chdir(tmpDir);
    process.exitCode = undefined;
    jest.clearAllMocks();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.remove(tmpDir);
    process.exitCode = undefined;
  });

  describe('computeTargetVersion', () => {
    it('preserves carat prefix', () => {
      expect(computeTargetVersion('^1.10.0', '1.12.0')).toBe('^1.12.0');
    });

    it('preserves tilde prefix', () => {
      expect(computeTargetVersion('~1.10.0', '1.12.0')).toBe('~1.12.0');
    });

    it('preserves exact version pin', () => {
      expect(computeTargetVersion('1.10.0', '1.12.0')).toBe('1.12.0');
    });

    it('preserves backstage:^ protocol', () => {
      expect(computeTargetVersion('backstage:^', '1.12.0')).toBe('backstage:^');
    });
  });

  describe('detectPackageManager', () => {
    it('detects yarn when yarn.lock is present', async () => {
      await fs.writeFile(path.join(tmpDir, 'yarn.lock'), '');
      const pm = await detectPackageManager(tmpDir);
      expect(pm).toBe('yarn');
    });

    it('defaults to npm when yarn.lock is absent', async () => {
      const pm = await detectPackageManager(tmpDir);
      expect(pm).toBe('npm');
    });
  });

  describe('upgradePluginDependencies', () => {
    it('throws error when package.json is missing', async () => {
      await expect(
        upgradePluginDependencies({ targetDir: tmpDir }),
      ).rejects.toThrow(/No package\.json found/);
    });

    it('updates package.json dependencies and backstage.json to match manifest', async () => {
      await setupFixture(
        {
          dependencies: {
            '@backstage/core-plugin-api': '^1.9.0',
            lodash: '^4.17.21',
          },
          devDependencies: {
            '@backstage/cli': '~0.30.0',
          },
        },
        [
          ['@backstage/core-plugin-api', '1.12.0'],
          ['@backstage/cli', '0.36.3'],
        ],
        '1.45.3',
      );

      const result = await upgradePluginDependencies({
        targetDir: tmpDir,
        skipInstall: true,
      });

      expect(result.rhdhVersion).toBe('2.0.0');
      expect(result.backstageVersion).toBe('1.52.0');
      expect(result.updatedFiles).toContain('package.json');
      expect(result.updatedFiles).toContain('backstage.json');

      const updatedPkg = await fs.readJson(path.join(tmpDir, 'package.json'));
      expect(updatedPkg.dependencies['@backstage/core-plugin-api']).toBe(
        '^1.12.0',
      );
      expect(updatedPkg.dependencies.lodash).toBe('^4.17.21'); // Untouched
      expect(updatedPkg.devDependencies['@backstage/cli']).toBe('~0.36.3');

      const updatedBsJson = await fs.readJson(
        path.join(tmpDir, 'backstage.json'),
      );
      expect(updatedBsJson.version).toBe('1.52.0');
    });

    it('does not write changes in dry-run mode', async () => {
      await setupFixture({
        dependencies: {
          '@backstage/core-plugin-api': '^1.9.0',
        },
      });

      const result = await upgradePluginDependencies({
        targetDir: tmpDir,
        dryRun: true,
      });

      expect(result.updatedFiles).toEqual([]);
      const pkg = await fs.readJson(path.join(tmpDir, 'package.json'));
      expect(pkg.dependencies['@backstage/core-plugin-api']).toBe('^1.9.0');
    });

    it('tracks unmanifested @backstage packages', async () => {
      await setupFixture(
        {
          dependencies: {
            '@backstage/unknown-pkg': '^1.0.0',
          },
        },
        [],
      );

      const result = await upgradePluginDependencies({
        targetDir: tmpDir,
        skipInstall: true,
      });

      expect(result.unmanifested).toContain('@backstage/unknown-pkg');
    });

    it('runs package manager install unless skipInstall is true', async () => {
      await setupFixture({
        dependencies: {
          '@backstage/core-plugin-api': '^1.9.0',
        },
      });

      mockRunPlain.mockResolvedValue('');

      const result = await upgradePluginDependencies({
        targetDir: tmpDir,
        skipInstall: false,
      });

      expect(result.installed).toBe(true);
      expect(mockRunPlain).toHaveBeenCalledWith(
        expect.stringMatching(/yarn|npm/),
        'install',
      );
    });
  });

  describe('CLI command handler', () => {
    it('outputs JSON when --json flag is passed', async () => {
      await setupFixture({
        dependencies: {
          '@backstage/core-plugin-api': '^1.9.0',
        },
      });

      const res = await runCommandWithOutput('2.0.0', {
        json: true,
        skipInstall: true,
      });
      const parsed = JSON.parse(res.stdout);
      expect(parsed.rhdhVersion).toBe('2.0.0');
      expect(parsed.backstageVersion).toBe('1.52.0');
      expect(parsed.changes).toHaveLength(1);
      expect(parsed.changes[0].changed).toBe(true);
    });

    it('prints formatted table and summary in human mode', async () => {
      await setupFixture({
        dependencies: {
          '@backstage/core-plugin-api': '^1.9.0',
        },
      });

      const res = await runCommandWithOutput('2.0.0', { skipInstall: true });
      expect(res.stderr).toContain('Package');
      expect(res.stderr).toContain('@backstage/core-plugin-api');
      expect(res.stderr).toContain('updated');
      expect(res.stderr).toContain('Successfully upgraded');
    });

    it('prints dry-run notification in dry-run mode', async () => {
      await setupFixture({
        dependencies: {
          '@backstage/core-plugin-api': '^1.9.0',
        },
      });

      const res = await runCommandWithOutput('2.0.0', { dryRun: true });
      expect(res.stderr).toContain('Dry run completed');
    });
  });
});

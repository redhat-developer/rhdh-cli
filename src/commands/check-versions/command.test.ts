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
import path from 'path';
import { resolveRhdhVersion } from '../../lib/rhdhVersion';
import { checkPluginDependencies, command } from './command';

jest.mock('../../lib/rhdhVersion', () => ({
  ...jest.requireActual('../../lib/rhdhVersion'),
  resolveRhdhVersion: jest.fn(),
}));

describe('checkPluginDependencies', () => {
  let tmpDir: string;
  let originalCwd: string;
  const mockResolveRhdhVersion = resolveRhdhVersion as jest.MockedFunction<
    typeof resolveRhdhVersion
  >;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-versions-test-'));
    process.chdir(tmpDir);
    process.exitCode = undefined;
    jest.clearAllMocks();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.remove(tmpDir);
    process.exitCode = undefined;
  });

  it('throws error when package.json does not exist', async () => {
    await expect(
      checkPluginDependencies({ targetDir: tmpDir }),
    ).rejects.toThrow(/No package\.json found/);
  });

  it('reports matching dependencies when versions align with manifest', async () => {
    const pkgJson = {
      name: 'test-plugin',
      dependencies: {
        '@backstage/core-plugin-api': '^1.12.0',
        '@backstage/catalog-model': '~1.7.6',
      },
      devDependencies: {
        '@backstage/cli': '0.36.3',
      },
      peerDependencies: {
        '@backstage/config': 'backstage:^',
      },
    };
    await fs.writeJson(path.join(tmpDir, 'package.json'), pkgJson);

    mockResolveRhdhVersion.mockResolvedValue({
      rhdhVersion: '2.0.0',
      backstageVersion: '1.52.0',
      source: 'matrix',
      packages: new Map([
        ['@backstage/core-plugin-api', '1.12.0'],
        ['@backstage/catalog-model', '1.7.6'],
        ['@backstage/cli', '0.36.3'],
        ['@backstage/config', '1.3.8'],
      ]),
    });

    const result = await checkPluginDependencies({ targetDir: tmpDir });

    expect(result.valid).toBe(true);
    expect(result.counts.matching).toBe(4);
    expect(result.counts.mismatched).toBe(0);
    expect(result.counts.unmanifested).toBe(0);
  });

  it('reports mismatched and unmanifested dependencies when versions differ', async () => {
    const pkgJson = {
      name: 'test-plugin',
      dependencies: {
        '@backstage/core-plugin-api': '^1.9.0', // Mismatched (expected 1.12.0)
        '@backstage/unknown-pkg': '^1.0.0', // Unmanifested
        lodash: '^4.17.21', // Non-backstage: ignored
      },
      devDependencies: {
        '@backstage/cli': '^0.30.0', // Mismatched (expected 0.36.3)
      },
    };
    await fs.writeJson(path.join(tmpDir, 'package.json'), pkgJson);

    mockResolveRhdhVersion.mockResolvedValue({
      rhdhVersion: '2.0.0',
      backstageVersion: '1.52.0',
      source: 'matrix',
      packages: new Map([
        ['@backstage/core-plugin-api', '1.12.0'],
        ['@backstage/cli', '0.36.3'],
      ]),
    });

    const result = await checkPluginDependencies({ targetDir: tmpDir });

    expect(result.valid).toBe(false);
    expect(result.counts.matching).toBe(0);
    expect(result.counts.mismatched).toBe(2);
    expect(result.counts.unmanifested).toBe(1);
    expect(result.counts.total).toBe(3);

    const corePluginApi = result.packages.find(
      p => p.name === '@backstage/core-plugin-api',
    );
    expect(corePluginApi?.status).toBe('mismatch');
    expect(corePluginApi?.declared).toBe('^1.9.0');
    expect(corePluginApi?.expected).toBe('1.12.0');

    const unknownPkg = result.packages.find(
      p => p.name === '@backstage/unknown-pkg',
    );
    expect(unknownPkg?.status).toBe('unmanifested');
    expect(unknownPkg?.expected).toBeUndefined();
  });

  describe('CLI command handler', () => {
    it('outputs JSON when --json flag is passed and sets exitCode on failure', async () => {
      const pkgJson = {
        name: 'test-plugin',
        dependencies: {
          '@backstage/core-plugin-api': '^1.9.0',
        },
      };
      await fs.writeJson(path.join(tmpDir, 'package.json'), pkgJson);

      mockResolveRhdhVersion.mockResolvedValue({
        rhdhVersion: '2.0.0',
        backstageVersion: '1.52.0',
        source: 'matrix',
        packages: new Map([['@backstage/core-plugin-api', '1.12.0']]),
      });

      const stdoutSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);

      try {
        await command({ json: true });

        expect(stdoutSpy).toHaveBeenCalled();
        const jsonCall = stdoutSpy.mock.calls[0][0] as string;
        const parsed = JSON.parse(jsonCall);
        expect(parsed.valid).toBe(false);
        expect(parsed.counts.mismatched).toBe(1);
        expect(process.exitCode).toBe(1);
      } finally {
        stdoutSpy.mockRestore();
      }
    });

    it('prints formatted table and remediation when run in human mode', async () => {
      const pkgJson = {
        name: 'test-plugin',
        dependencies: {
          '@backstage/core-plugin-api': '^1.9.0',
        },
      };
      await fs.writeJson(path.join(tmpDir, 'package.json'), pkgJson);

      mockResolveRhdhVersion.mockResolvedValue({
        rhdhVersion: '2.0.0',
        backstageVersion: '1.52.0',
        source: 'matrix',
        packages: new Map([['@backstage/core-plugin-api', '1.12.0']]),
      });

      const stderrSpy = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      try {
        await command({});

        expect(stderrSpy).toHaveBeenCalled();
        const output = stderrSpy.mock.calls.map(c => c[0]).join('');
        expect(output).toContain('Package');
        expect(output).toContain('@backstage/core-plugin-api');
        expect(output).toContain('mismatch');
        expect(output).toContain('rhdh-cli plugin upgrade 2.0.0');
        expect(process.exitCode).toBe(1);
      } finally {
        stderrSpy.mockRestore();
      }
    });

    it('prints success message when dependencies are aligned', async () => {
      const pkgJson = {
        name: 'test-plugin',
        dependencies: {
          '@backstage/core-plugin-api': '^1.12.0',
        },
      };
      await fs.writeJson(path.join(tmpDir, 'package.json'), pkgJson);

      mockResolveRhdhVersion.mockResolvedValue({
        rhdhVersion: '2.0.0',
        backstageVersion: '1.52.0',
        source: 'matrix',
        packages: new Map([['@backstage/core-plugin-api', '1.12.0']]),
      });

      const stderrSpy = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      try {
        await command({});

        expect(stderrSpy).toHaveBeenCalled();
        const output = stderrSpy.mock.calls.map(c => c[0]).join('');
        expect(output).toContain('All @backstage dependencies are aligned');
        expect(process.exitCode).toBeUndefined();
      } finally {
        stderrSpy.mockRestore();
      }
    });
  });
});

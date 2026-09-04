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

  async function setupFixture(
    pkg: {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    },
    manifestPackages: [string, string][] = [
      ['@backstage/core-plugin-api', '1.12.0'],
    ],
  ) {
    await fs.writeJson(path.join(tmpDir, 'package.json'), {
      name: 'test-plugin',
      ...pkg,
    });
    mockResolveRhdhVersion.mockResolvedValue({
      rhdhVersion: '2.0.0',
      backstageVersion: '1.52.0',
      source: 'matrix',
      packages: new Map(manifestPackages),
    });
  }

  async function runCommandWithOutput(opts: any = {}) {
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
      await command(opts);
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }

    return { stdout, stderr, exitCode: process.exitCode };
  }

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
    await setupFixture(
      {
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
      },
      [
        ['@backstage/core-plugin-api', '1.12.0'],
        ['@backstage/catalog-model', '1.7.6'],
        ['@backstage/cli', '0.36.3'],
        ['@backstage/config', '1.3.8'],
      ],
    );

    const result = await checkPluginDependencies({ targetDir: tmpDir });

    expect(result.valid).toBe(true);
    expect(result.counts.matching).toBe(4);
    expect(result.counts.mismatched).toBe(0);
    expect(result.counts.unmanifested).toBe(0);
  });

  it('reports mismatched and unmanifested dependencies when versions differ', async () => {
    await setupFixture(
      {
        dependencies: {
          '@backstage/core-plugin-api': '^1.9.0',
          '@backstage/unknown-pkg': '^1.0.0',
          lodash: '^4.17.21',
        },
        devDependencies: {
          '@backstage/cli': '^0.30.0',
        },
      },
      [
        ['@backstage/core-plugin-api', '1.12.0'],
        ['@backstage/cli', '0.36.3'],
      ],
    );

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
      await setupFixture({
        dependencies: { '@backstage/core-plugin-api': '^1.9.0' },
      });

      const res = await runCommandWithOutput({ json: true });
      const parsed = JSON.parse(res.stdout);
      expect(parsed.valid).toBe(false);
      expect(parsed.counts.mismatched).toBe(1);
      expect(res.exitCode).toBe(1);
    });

    it('prints formatted table and remediation when run in human mode', async () => {
      await setupFixture({
        dependencies: { '@backstage/core-plugin-api': '^1.9.0' },
      });

      const res = await runCommandWithOutput({});
      expect(res.stderr).toContain('Package');
      expect(res.stderr).toContain('@backstage/core-plugin-api');
      expect(res.stderr).toContain('mismatch');
      expect(res.stderr).toContain('rhdh-cli plugin upgrade 2.0.0');
      expect(res.exitCode).toBe(1);
    });

    it('prints success message when dependencies are aligned', async () => {
      await setupFixture({
        dependencies: { '@backstage/core-plugin-api': '^1.12.0' },
      });

      const res = await runCommandWithOutput({});
      expect(res.stderr).toContain('All @backstage dependencies are aligned');
      expect(res.exitCode).toBeUndefined();
    });
  });
});

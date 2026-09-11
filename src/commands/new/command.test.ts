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
import os from 'node:os';
import path from 'node:path';

import { resolveRhdhVersion } from '../../lib/rhdhVersion';
import { completeInteractiveOptions, createPluginProject } from './command';

jest.mock('../../lib/rhdhVersion', () => ({
  ...jest.requireActual('../../lib/rhdhVersion'),
  resolveRhdhVersion: jest.fn(),
}));

describe('createPluginProject', () => {
  let tmpDir: string;
  const mockResolveRhdhVersion = resolveRhdhVersion as jest.MockedFunction<
    typeof resolveRhdhVersion
  >;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-new-test-'));
    mockResolveRhdhVersion.mockResolvedValue({
      rhdhVersion: '2.1.0',
      backstageVersion: '1.54.0',
      source: 'matrix',
      packages: new Map([
        ['@backstage/backend-plugin-api', '1.10.0'],
        ['@backstage/catalog-model', '1.10.0'],
        ['@backstage/cli', '0.36.5'],
        ['@backstage/core-plugin-api', '1.12.7'],
        ['@backstage/frontend-plugin-api', '0.17.2'],
        ['@backstage/plugin-catalog-node', '2.2.4'],
      ]),
    });
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
    jest.clearAllMocks();
  });

  it.each([
    ['frontend', 'src/index.ts', 'PageBlueprint'],
    ['backend', 'src/index.ts', 'createBackendPlugin'],
    ['backend-module', 'src/index.ts', 'catalogProcessingExtensionPoint'],
  ])(
    'creates a %s plugin project',
    async (type, entryPoint, expectedSource) => {
      const output = path.join(tmpDir, type);

      const result = await createPluginProject({
        name: 'example-plugin',
        type,
        output,
        rhdhVersion: '2.1.0',
      });

      expect(result).toEqual({
        outputDir: output,
        rhdhVersion: '2.1.0',
        backstageVersion: '1.54.0',
      });
      expect(mockResolveRhdhVersion).toHaveBeenCalledWith('2.1.0', {
        manifestFile: undefined,
      });
      expect(
        await fs.readFile(path.join(output, entryPoint), 'utf8'),
      ).toContain(expectedSource);

      const packageJson = await fs.readJson(path.join(output, 'package.json'));
      expect(packageJson.devDependencies['@backstage/cli']).toBe('0.36.5');
      expect(packageJson.devDependencies).not.toHaveProperty(
        '@red-hat-developer-hub/cli',
      );
      expect(packageJson.packageManager).toBe('yarn@4.17.1');
      await expect(
        fs.readFile(path.join(output, '.yarnrc.yml'), 'utf8'),
      ).resolves.toBe('nodeLinker: node-modules\n');
      await expect(
        fs.readFile(path.join(output, 'README.md'), 'utf8'),
      ).resolves.toContain('npx @red-hat-developer-hub/cli plugin export');
      await expect(
        fs.readJson(path.join(output, 'backstage.json')),
      ).resolves.toEqual({ version: '1.54.0' });
    },
  );

  it('rejects an invalid name before resolving a version', async () => {
    await expect(
      createPluginProject({
        name: 'Example',
        type: 'frontend',
        output: tmpDir,
      }),
    ).rejects.toThrow('Plugin name must start');
    expect(mockResolveRhdhVersion).not.toHaveBeenCalled();
  });

  it('rejects a non-empty output directory', async () => {
    await fs.outputFile(path.join(tmpDir, 'existing'), 'content');

    await expect(
      createPluginProject({
        name: 'example',
        type: 'frontend',
        output: tmpDir,
      }),
    ).rejects.toThrow('is not empty');
    expect(mockResolveRhdhVersion).not.toHaveBeenCalled();
  });

  it('prompts only for missing name and plugin type', async () => {
    const prompt = jest
      .fn<Promise<string>, [string]>()
      .mockResolvedValueOnce('example-plugin')
      .mockResolvedValueOnce('frontend');

    await expect(
      completeInteractiveOptions({ rhdhVersion: '2.1.0' }, prompt),
    ).resolves.toEqual({
      name: 'example-plugin',
      type: 'frontend',
      rhdhVersion: '2.1.0',
    });
    expect(prompt).toHaveBeenCalledTimes(2);
  });
});

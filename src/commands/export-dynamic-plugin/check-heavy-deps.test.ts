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

import mockFs from 'mock-fs';

import { Task } from '../../lib/tasks';
import { checkHeavyDependencies } from './check-heavy-deps';

describe('checkHeavyDependencies', () => {
  const targetPath = '/tmp/dist-dynamic';
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Task, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    mockFs.restore();
    logSpy.mockRestore();
  });

  describe('backend', () => {
    it('does not warn when no heavy deps are present', async () => {
      mockFs({
        [targetPath]: {
          'package.json': JSON.stringify({
            dependencies: {
              '@backstage/backend-plugin-api': '1.0.0',
              '@backstage/plugin-auth-node': '1.0.0',
            },
          }),
        },
      });

      await checkHeavyDependencies(targetPath, false, 'backend');

      expect(logSpy).not.toHaveBeenCalled();
    });

    it('warns for each heavy dependency in production dependencies', async () => {
      mockFs({
        [targetPath]: {
          'package.json': JSON.stringify({
            dependencies: {
              '@backstage/backend-defaults': '1.0.0',
              '@backstage/backend-app-api': '1.0.0',
            },
          }),
        },
      });

      await checkHeavyDependencies(targetPath, false, 'backend');

      expect(logSpy).toHaveBeenCalledTimes(2);
      expect(logSpy.mock.calls[0][0]).toContain(
        'WARNING: Found heavy dependency @backstage/backend-defaults',
      );
      expect(logSpy.mock.calls[1][0]).toContain(
        'WARNING: Found heavy dependency @backstage/backend-app-api',
      );
      expect(logSpy.mock.calls[0][0]).toContain(
        'Should not be used in backend plugins',
      );
      expect(logSpy.mock.calls[0][0]).not.toMatch(/~\d+/);
    });

    it('throws in strict mode after logging all violations', async () => {
      mockFs({
        [targetPath]: {
          'package.json': JSON.stringify({
            dependencies: {
              '@backstage/backend-test-utils': '1.0.0',
            },
          }),
        },
      });

      await expect(
        checkHeavyDependencies(targetPath, true, 'backend'),
      ).rejects.toThrow(
        'Found 1 disallowed dependency in production dependencies',
      );
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toContain(
        'WARNING: Found heavy dependency @backstage/backend-test-utils',
      );
    });

    it('only checks production dependencies', async () => {
      mockFs({
        [targetPath]: {
          'package.json': JSON.stringify({
            dependencies: {
              '@backstage/backend-plugin-api': '1.0.0',
            },
            devDependencies: {
              '@backstage/backend-test-utils': '1.0.0',
            },
            peerDependencies: {
              '@backstage/backend-defaults': '1.0.0',
            },
          }),
        },
      });

      await checkHeavyDependencies(targetPath, false, 'backend');

      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('frontend', () => {
    it('does not warn when no heavy deps are present', async () => {
      mockFs({
        [targetPath]: {
          'package.json': JSON.stringify({
            dependencies: {
              '@backstage/frontend-plugin-api': '1.0.0',
              '@backstage/core-components': '1.0.0',
            },
          }),
        },
      });

      await checkHeavyDependencies(targetPath, false, 'frontend');

      expect(logSpy).not.toHaveBeenCalled();
    });

    it('warns for app-level and dev/test frontend dependencies', async () => {
      mockFs({
        [targetPath]: {
          'package.json': JSON.stringify({
            dependencies: {
              '@backstage/core-app-api': '1.0.0',
              '@backstage/frontend-defaults': '1.0.0',
              '@backstage/frontend-test-utils': '1.0.0',
            },
          }),
        },
      });

      await checkHeavyDependencies(targetPath, false, 'frontend');

      expect(logSpy).toHaveBeenCalledTimes(3);
      expect(logSpy.mock.calls[0][0]).toContain(
        'WARNING: Found heavy dependency @backstage/core-app-api',
      );
      expect(logSpy.mock.calls[1][0]).toContain(
        'WARNING: Found heavy dependency @backstage/frontend-defaults',
      );
      expect(logSpy.mock.calls[2][0]).toContain(
        'WARNING: Found heavy dependency @backstage/frontend-test-utils',
      );
    });

    it('does not flag allowed plugin API packages', async () => {
      mockFs({
        [targetPath]: {
          'package.json': JSON.stringify({
            dependencies: {
              '@backstage/core-plugin-api': '1.0.0',
              '@backstage/frontend-plugin-api': '1.0.0',
            },
          }),
        },
      });

      await checkHeavyDependencies(targetPath, false, 'frontend');

      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});

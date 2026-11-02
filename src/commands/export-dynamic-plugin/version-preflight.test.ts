/*
 * Copyright 2024 The Backstage Authors
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

/**
 * Focused test for the frontend version preflight check. A plugin whose
 * package.json has no version would otherwise fail inside the packer.
 */

jest.mock('../../lib/paths', () => ({
  paths: {
    targetDir: '/tmp/test-plugin',
    targetRoot: '/tmp/test-plugin',
    resolveTarget: (...parts: string[]) =>
      `/tmp/test-plugin/${parts.join('/')}`,
  },
}));

// Stub out heavy analysis helpers that run after the version check.
jest.mock('@manypkg/get-packages', () => ({
  getPackages: jest.fn().mockResolvedValue({ packages: [] }),
}));
jest.mock('../../lib/run', () => ({ run: jest.fn(), runPlain: jest.fn() }));
jest.mock('../../lib/tasks', () => {
  const orig = jest.requireActual('../../lib/tasks');
  return { Task: { ...orig.Task, log: jest.fn(), error: jest.fn() } };
});
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execSync: jest.fn().mockReturnValue(Buffer.from('4.0.0')),
}));

const FRONTEND_PKG_NO_VERSION = { name: '@internal/my-frontend' };

jest.mock('fs-extra', () => {
  const actual = jest.requireActual('fs-extra');
  return {
    ...actual,
    readJson: jest.fn(),
    pathExists: jest.fn().mockResolvedValue(true),
    ensureDir: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  };
});

// Static imports — mocks above are hoisted by Jest's babel transform.
import { frontend } from './frontend';
import { PackageRoleInfo } from '@backstage/cli-node';
import fs from 'fs-extra';

const mockReadJson = fs.readJson as jest.MockedFunction<typeof fs.readJson>;

beforeEach(() => {
  jest.clearAllMocks();
});

const FRONTEND_ROLE: PackageRoleInfo = {
  role: 'frontend-plugin',
  platform: 'web',
  output: ['bundle'],
};

describe('frontend export version preflight', () => {
  it('throws a clear error when package.json has no version field', async () => {
    mockReadJson.mockResolvedValue(FRONTEND_PKG_NO_VERSION as any);

    await expect(frontend(FRONTEND_ROLE, {})).rejects.toThrow('missing a');
  });
});

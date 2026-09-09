/*
 * Copyright 2022 The Backstage Authors
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
import { command } from './command';

describe('package-dynamic-plugins command', () => {
  let tmpDir: string;

  beforeEach(() => {
    // Create a fresh temp directory for each test
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhdh-cli-test-'));
    // Change to temp directory for tests
    process.chdir(tmpDir);
  });

  afterEach(() => {
    // Clean up temp directory
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.removeSync(tmpDir);
    }
  });

  describe('RHDHBUGS-3633: Fail-fast validation', () => {
    it('should validate neither tag nor export-to provided', async () => {
      // Create a minimal package.json
      fs.writeJsonSync(path.join(tmpDir, 'package.json'), {
        name: 'test',
        version: '1.0.0',
      });

      // Should return without error when neither is provided (early return)
      await expect(command({})).resolves.toBeUndefined();
    });

    it('should succeed with existing dist-dynamic and exportTo', async () => {
      const exportDir = path.join(tmpDir, 'export');

      // Create a plugin with dist-dynamic
      fs.writeJsonSync(path.join(tmpDir, 'package.json'), {
        name: 'test-plugin',
        version: '1.0.0',
        backstage: { role: 'frontend-plugin' },
      });

      const distDynamicDir = path.join(tmpDir, 'dist-dynamic');
      fs.mkdirSync(distDynamicDir);
      fs.writeJsonSync(path.join(distDynamicDir, 'package.json'), {
        name: 'test-plugin-dynamic',
        version: '1.0.0',
      });

      // Export to directory (no container build, uses existing dist-dynamic)
      await command({
        exportTo: exportDir,
      });

      // Verify export directory was created
      expect(fs.existsSync(exportDir)).toBe(true);
      expect(fs.existsSync(path.join(exportDir, 'index.json'))).toBe(true);
    }, 30000);
  });
});

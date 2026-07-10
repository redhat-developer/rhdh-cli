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

import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import { Task } from '../../lib/tasks';

export const HEAVY_BACKEND_DEPS: Record<string, string> = {
  '@backstage/backend-defaults':
    'Should not be used in backend plugins. Use @backstage/backend-plugin-api instead.',
  '@backstage/backend-app-api':
    'Should not be used in backend plugins. Use @backstage/backend-plugin-api instead.',
  '@backstage/backend-test-utils':
    'Should not be used in production dependencies. Move to devDependencies.',
  '@backstage/backend-dynamic-feature-service':
    'Should not be used in backend plugins. Use the -node variant instead.',
};

export async function checkHeavyDependencies(
  targetPath: string,
  strict: boolean,
): Promise<void> {
  const packageJsonPath = path.join(targetPath, 'package.json');
  const targetPackage = await fs.readJson(packageJsonPath);
  const dependencies: Record<string, string> = targetPackage.dependencies ?? {};

  const violations = Object.keys(dependencies).filter(
    dep => dep in HEAVY_BACKEND_DEPS,
  );

  if (violations.length === 0) {
    return;
  }

  for (const dep of violations) {
    Task.log(
      chalk.yellow(
        [
          `WARNING: Found heavy dependency ${chalk.cyan(dep)} in production dependencies.`,
          `  ${HEAVY_BACKEND_DEPS[dep]}`,
        ].join('\n'),
      ),
    );
  }

  if (strict) {
    throw new Error(
      `Found ${violations.length} disallowed ${violations.length === 1 ? 'dependency' : 'dependencies'} in production dependencies. Remove ${violations.length === 1 ? 'it' : 'them'} or omit --strict-deps to export with warnings only.`,
    );
  }
}

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

export const HEAVY_FRONTEND_DEPS: Record<string, string> = {
  '@backstage/core-app-api':
    'Should not be used in frontend plugins. Use @backstage/frontend-plugin-api or @backstage/core-plugin-api instead.',
  '@backstage/frontend-app-api':
    'Should not be used in frontend plugins. Use @backstage/frontend-plugin-api instead.',
  '@backstage/frontend-defaults':
    'App-level wiring only. Use in app packages or move to devDependencies.',
  '@backstage/app-defaults':
    'App-level wiring only. Use in app packages or move to devDependencies.',
  '@backstage/dev-utils':
    'Dev server helper only. Move to devDependencies.',
  '@backstage/frontend-dev-utils':
    'Dev server helper only. Move to devDependencies.',
  '@backstage/frontend-test-utils':
    'Test utilities only. Move to devDependencies.',
  '@backstage/test-utils':
    'Test utilities only. Move to devDependencies.',
  '@backstage/frontend-dynamic-feature-loader':
    'App-level dynamic feature loading. Should not be a plugin production dependency.',
};

export type HeavyDepKind = 'backend' | 'frontend';

const HEAVY_DEPS_BY_KIND: Record<HeavyDepKind, Record<string, string>> = {
  backend: HEAVY_BACKEND_DEPS,
  frontend: HEAVY_FRONTEND_DEPS,
};

export async function checkHeavyDependencies(
  targetPath: string,
  strict: boolean,
  kind: HeavyDepKind,
): Promise<void> {
  const blocklist = HEAVY_DEPS_BY_KIND[kind];
  const packageJsonPath = path.join(targetPath, 'package.json');
  const targetPackage = await fs.readJson(packageJsonPath);
  const dependencies: Record<string, string> = targetPackage.dependencies ?? {};

  const violations = Object.keys(dependencies).filter(dep => dep in blocklist);

  if (violations.length === 0) {
    return;
  }

  for (const dep of violations) {
    Task.log(
      chalk.yellow(
        [
          `WARNING: Found heavy dependency ${chalk.cyan(dep)} in production dependencies.`,
          `  ${blocklist[dep]}`,
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

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

import {
  BackstagePackageFeatureType,
  BackstagePackageJson,
} from '@backstage/cli-node';
import { readEntryPoints } from '@backstage/cli-module-build/dist/lib/entryPoints.cjs.js';
import {
  createTypeDistProject,
  getEntryPointDefaultFeatureType,
} from '@backstage/cli-module-build/dist/lib/typeDistProject.cjs.js';

import chalk from 'chalk';

import { Task } from '../../lib/tasks';

/**
 * Detects backstage feature types for all entry points in a package by
 * analyzing the default export's $$type using ts-morph type resolution.
 *
 * Mirrors the feature detection in upstream Backstage's `productionPack`
 * (packages/cli-module-build/src/lib/packager/productionPack.ts), which
 * populates `backstage.features` in package.json during `backstage-cli pack`.
 * Since rhdh-cli's forked `productionPack` predates that addition, we
 * perform the same detection here as a separate step.
 *
 * Returns a map of entry point mount to feature type, or undefined if
 * no features were detected.
 */
export async function detectBackstageFeatures(
  originalPkg: BackstagePackageJson,
  packageDir: string,
): Promise<Record<string, BackstagePackageFeatureType> | undefined> {
  const role = originalPkg.backstage?.role;
  if (!role) {
    return undefined;
  }

  const project = await createTypeDistProject();
  const entryPoints = readEntryPoints(originalPkg);
  const features: Record<string, BackstagePackageFeatureType> = {};

  for (const ep of entryPoints) {
    if (ep.mount === './package.json') {
      continue;
    }

    try {
      const featureType = getEntryPointDefaultFeatureType(
        role,
        packageDir,
        project,
        ep.path,
      );

      if (featureType) {
        features[ep.mount] = featureType;
        Task.log(
          `  detected backstage feature: ${chalk.cyan(ep.mount)} => ${chalk.green(featureType)}`,
        );
      }
    } catch (error) {
      Task.log(
        chalk.yellow(
          `Failed to detect backstage feature type for entry point ${chalk.cyan(ep.mount)}: ${error}`,
        ),
      );
    }
  }

  return Object.keys(features).length > 0 ? features : undefined;
}

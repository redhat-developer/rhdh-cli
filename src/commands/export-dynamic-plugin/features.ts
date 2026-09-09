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
import { resolve as resolvePath } from 'node:path';

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
      const featureType = getDefaultFeatureType(
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

/**
 * Resolves a default feature type through re-exported default exports.
 *
 * The upstream helper resolves the type in the entry point itself, but does
 * not follow an ExportSpecifier's module declaration. This is common for NFS
 * entry points, which often re-export their plugin from an index module.
 */
export function getDefaultFeatureType(
  role: Parameters<typeof getEntryPointDefaultFeatureType>[0],
  packageDir: string,
  project: Parameters<typeof getEntryPointDefaultFeatureType>[2],
  entryPoint: string,
  visited = new Set<string>(),
): BackstagePackageFeatureType | null {
  const sourceFilePath = resolvePath(packageDir, entryPoint);

  if (visited.has(sourceFilePath)) {
    return null;
  }
  visited.add(sourceFilePath);

  const featureType = getEntryPointDefaultFeatureType(
    role,
    packageDir,
    project,
    sourceFilePath,
  );

  if (featureType) {
    return featureType;
  }

  const sourceFile = project.getSourceFile(sourceFilePath);
  if (!sourceFile) {
    return null;
  }

  for (const exportSymbol of sourceFile.getExportSymbols()) {
    const declaration = exportSymbol.getDeclarations()[0];
    if (
      !declaration ||
      declaration.getSymbol()?.getName() !== 'default' ||
      declaration.getKindName() !== 'ExportSpecifier'
    ) {
      continue;
    }

    const reExportedSourceFile = declaration
      .getExportDeclaration()
      ?.getModuleSpecifierSourceFile();
    if (!reExportedSourceFile) {
      continue;
    }

    const reExportedFeatureType: BackstagePackageFeatureType | null =
      getDefaultFeatureType(
        role,
        packageDir,
        project,
        reExportedSourceFile.getFilePath(),
        visited,
      );
    if (reExportedFeatureType) {
      return reExportedFeatureType;
    }
  }

  return null;
}

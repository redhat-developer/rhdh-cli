/*
 * Copyright 2023 The Backstage Authors
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

import { PackageRoleInfo } from '@backstage/cli-node';
import { buildFrontend } from './buildFrontend';

import { getPackages } from '@manypkg/get-packages';
import chalk from 'chalk';
import { OptionValues } from 'commander';
import fs from 'fs-extra';

import path from 'path';

import { productionPack } from '../../lib/packager/productionPack';
import { paths } from '../../lib/paths';
import { Task } from '../../lib/tasks';
import { customizeForDynamicUse, getMonorepoRootResolutions } from './backend';
import { detectBackstageFeatures } from './features';

function isTruthyCiEnv(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

async function warnAboutLegacyScalprum(
  packageJson: Record<string, unknown>,
): Promise<void> {
  const references: string[] = [];
  if ('scalprum' in packageJson) {
    references.push('the `scalprum` package field');
  }
  if (Array.isArray(packageJson.files)) {
    for (const file of packageJson.files) {
      if (typeof file === 'string' && file.includes('dist-scalprum')) {
        references.push(`the \`${file}\` files entry`);
      }
    }
  }
  if (await fs.pathExists(path.join(paths.targetDir, 'dist-scalprum'))) {
    references.push('the `dist-scalprum` directory');
  }

  if (references.length > 0) {
    const message = `Legacy Scalprum content detected: ${references.join(', ')}. Remove it before exporting.`;
    Task.log(`${chalk.yellow('Warning:')} ${message}`);
  }
}

export async function frontend(
  _: PackageRoleInfo,
  opts: OptionValues,
): Promise<string> {
  const originalPkg = await fs.readJson(paths.resolveTarget('package.json'));
  const { name, files } = originalPkg;

  if (opts.clean) {
    await fs.remove(path.join(paths.targetDir, 'dist'));
  }

  Task.log(
    `Generating standard module federation assets in ${chalk.cyan(
      path.join(paths.targetDir, 'dist'),
    )}`,
  );
  const previousCi = process.env.CI;
  const unsetCiForMfBuild = isTruthyCiEnv(previousCi);
  if (unsetCiForMfBuild) {
    process.env.CI = 'false';
  }
  try {
    await buildFrontend({
      targetDir: paths.targetDir,
      configPaths: [],
      writeStats: false,
      isModuleFederationRemote: true,
    });
  } finally {
    if (unsetCiForMfBuild) {
      if (previousCi === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = previousCi;
      }
    }
  }

  await warnAboutLegacyScalprum(originalPkg);

  const distDynamicRelativePath = 'dist-dynamic';
  const target = path.resolve(paths.targetDir, distDynamicRelativePath);
  Task.log(
    `Packing main package to ${chalk.cyan(
      path.join(distDynamicRelativePath, 'package.json'),
    )}`,
  );

  if (opts.clean) {
    await fs.remove(target);
  }

  await fs.mkdirs(target);
  await fs.writeFile(
    path.join(target, '.gitignore'),
    `
*
`,
  );

  await productionPack({
    packageDir: paths.targetDir,
    targetDir: target,
  });

  Task.log(
    `Customizing main package in ${chalk.cyan(
      path.join(distDynamicRelativePath, 'package.json'),
    )} for dynamic loading`,
  );
  const detectedFeatures = await detectBackstageFeatures(
    originalPkg,
    paths.targetDir,
  );

  const monoRepoPackages = await getPackages(paths.targetDir);

  const rootResolutions = await getMonorepoRootResolutions();

  await customizeForDynamicUse({
    embedded: [],
    isYarnV1: false,
    monoRepoPackages,
    overridding: {
      name: `${name}-dynamic`,
      // We remove scripts, because they do not make sense for this derived package.
      // They even bring errors, especially the pre-pack and post-pack ones:
      // we want to be able to use npm pack on this derived package to distribute it as a dynamic plugin,
      // and obviously this should not trigger the backstage pre-pack or post-pack actions
      // which are related to the packaging of the original static package.
      scripts: {},
      files,
    },
    rootResolutions,
    after: pkg => {
      if (detectedFeatures) {
        pkg.backstage = pkg.backstage ?? {};
        pkg.backstage.features = detectedFeatures;
      }
    },
  })(path.resolve(target, 'package.json'));

  return target;
}

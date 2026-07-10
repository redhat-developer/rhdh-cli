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

import { PackageRoles } from '@backstage/cli-node';
import { bundleCommand } from '@backstage/cli-module-build/dist/commands/package/bundle/command.cjs.js';

import chalk from 'chalk';
import { OptionValues } from 'commander';
import fs from 'fs-extra';
import * as semver from 'semver';

import path from 'path';

import { paths } from '../../lib/paths';
import { getConfigSchema } from '../../lib/schema/collect';
import { Task } from '../../lib/tasks';
import { checkHeavyDependencies } from './check-heavy-deps';
import { applyDevOptions } from './dev';
import { frontend } from './frontend';

const DEPRECATED_FLAGS: Record<string, string> = {
  embedPackage:
    '--embed-package is deprecated and ignored. The upstream bundle command embeds all dependencies automatically.',
  sharedPackage:
    '--shared-package is deprecated and ignored. The upstream bundle command produces fully self-contained bundles.',
  allowNativePackage: '--allow-native-package is deprecated and ignored.',
  suppressNativePackage: '--suppress-native-package is deprecated and ignored.',
  ignoreVersionCheck: '--ignore-version-check is deprecated and ignored.',
  minify: '--minify is deprecated and ignored.',
  trackDynamicManifestAndLockFile:
    '--track-dynamic-manifest-and-lock-file is deprecated and ignored.',
};

function warnDeprecatedFlags(opts: OptionValues): void {
  for (const [flag, message] of Object.entries(DEPRECATED_FLAGS)) {
    const value = opts[flag];
    if (value !== undefined && value !== false) {
      Task.log(chalk.yellow(message));
    }
  }
}

export async function command(opts: OptionValues): Promise<void> {
  const rawPkg = await fs.readJson(paths.resolveTarget('package.json'));
  const role = PackageRoles.getRoleFromPackage(rawPkg);
  if (!role) {
    throw new Error(`Target package must have 'backstage.role' set`);
  }

  let targetPath: string;
  const roleInfo = PackageRoles.getRoleInfo(role);
  if (role === 'backend-plugin' || role === 'backend-plugin-module') {
    warnDeprecatedFlags(opts);

    await bundleCommand({
      clean: Boolean(opts.clean),
      build: opts.build !== false,
      install: opts.install !== false,
      verbose: Boolean(opts.verbose),
      outputName: 'dist-dynamic',
      outputDestination: opts.outputDestination,
      prePackedDir: opts.prePackedDir,
    });

    targetPath = path.join(paths.targetDir, 'dist-dynamic');

    // Rename package to ${name}-dynamic
    const targetPkgPath = path.join(targetPath, 'package.json');
    const targetPkg = await fs.readJson(targetPkgPath);
    targetPkg.name = `${rawPkg.name}-dynamic`;
    await fs.writeJson(targetPkgPath, targetPkg, { spaces: 2 });

    // Copy config schema to the path RHDH's schemaLocator expects
    const upstreamSchema = path.join(targetPath, 'dist', '.config-schema.json');
    const rhdhSchema = path.join(targetPath, 'dist', 'configSchema.json');
    if (await fs.pathExists(upstreamSchema)) {
      await fs.copy(upstreamSchema, rhdhSchema);
    }

    await checkHeavyDependencies(targetPath, Boolean(opts.strictDeps));
  } else if (role === 'frontend-plugin' || role === 'frontend-plugin-module') {
    targetPath = await frontend(roleInfo, opts);
    const configSchemaPaths: string[] = [];
    if (fs.existsSync(path.join(targetPath, 'dist-scalprum'))) {
      configSchemaPaths.push(
        path.join(targetPath, 'dist-scalprum/configSchema.json'),
      );
    }
    if (fs.existsSync(path.join(targetPath, 'dist'))) {
      configSchemaPaths.push(path.join(targetPath, 'dist/.config-schema.json'));
    }

    if (configSchemaPaths.length > 0) {
      Task.log(
        `Saving self-contained config schema in ${chalk.cyan(configSchemaPaths.join(' and '))}`,
      );

      const configSchema = await getConfigSchema(rawPkg.name);
      for (const configSchemaPath of configSchemaPaths) {
        await fs.writeJson(
          paths.resolveTarget(configSchemaPath),
          configSchema,
          {
            encoding: 'utf8',
            spaces: 2,
          },
        );
      }
    }
  } else {
    throw new Error(
      'Only packages with the "backend-plugin", "backend-plugin-module", "frontend-plugin" or "frontend-plugin-module" roles can be exported as dynamic plugins',
    );
  }

  await checkBackstageSupportedVersions(targetPath);

  await applyDevOptions(opts, rawPkg.name, roleInfo, targetPath);
}

async function checkBackstageSupportedVersions(targetPath: string) {
  const targetPackageFile = path.join(targetPath, 'package.json');
  const targetPackage = await fs.readJSON(targetPackageFile);
  const supportedVersions: string | undefined =
    targetPackage.backstage?.['supported-versions'];
  const backstageJson = path.join(paths.targetRoot, '/backstage.json');
  if (!fs.existsSync(backstageJson)) {
    return;
  }
  const backstageVersion: string = (await fs.readJSON(backstageJson)).version;
  if (supportedVersions) {
    const singleVersionInSupportedVersions = semver.valid(
      supportedVersions,
      true,
    );
    const supportedVersionsRange = singleVersionInSupportedVersions
      ? `~${supportedVersions}`
      : supportedVersions;

    if (semver.subset(`~${backstageVersion}`, supportedVersionsRange)) {
      return;
    }
    const errorMessage = `The ${chalk.cyan('backstage.supported-versions')} field in the package descriptor is not compatible with the backstage version specified in the ${chalk.cyan('backstage.json')} file: ${chalk.cyan(supportedVersions)} vs ${chalk.cyan(backstageVersion)}.`;
    if (!singleVersionInSupportedVersions) {
      throw new Error(errorMessage);
    }
    Task.log(
      chalk.yellow(
        `${errorMessage}\nOverriding it with ${chalk.cyan(backstageVersion)}.`,
      ),
    );
  } else {
    Task.log(
      `Filling ${chalk.cyan('supported-versions')} with ${chalk.cyan(backstageVersion)}.`,
    );
  }
  targetPackage.backstage['supported-versions'] = backstageVersion;
  await fs.writeJSON(targetPackageFile, targetPackage, {
    spaces: 2,
  });
}

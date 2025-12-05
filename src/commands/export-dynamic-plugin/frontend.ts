/*
 * Copyright 2023 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { buildFrontend } from '@backstage/cli/dist/modules/build/lib/buildFrontend.cjs.js';
import { getPackages } from '@manypkg/get-packages';
import chalk from 'chalk';
import { OptionValues } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'node:child_process';

import { buildScalprumPlugin } from '../../lib/builder/buildScalprumPlugin';
import { productionPack } from '../../lib/packager/productionPack';
import { paths } from '../../lib/paths';
import { Task } from '../../lib/tasks';
import { customizeForDynamicUse, locateAndCopyYarnLock } from './common-utils';

/**
 * The main entrypoint for exporting frontend Backstage plugins
 * @param opts
 * @returns
 */
export async function frontend(opts: OptionValues): Promise<string> {
  const {
    name,
    version,
    scalprum: scalprumInline,
    files,
  } = await fs.readJson(paths.resolveTarget('package.json'));

  if (!opts.generateScalprumAssets && !opts.generateModuleFederationAssets) {
    throw new Error(
      'You should use at least one of the 2 options: --generate-scalprum-assets or --generate-module-federation-assets.',
    );
  }

  // 1. Generate Module Federation Assets
  await generateModuleFederationAssets(opts);

  // 2. Prepare Target Directory
  const targetRelativePath = 'dist-dynamic';
  const target = path.resolve(paths.targetDir, targetRelativePath);

  Task.log(
    `Packing main package to ${chalk.cyan(
      path.join(targetRelativePath, 'package.json'),
    )}`,
  );

  if (opts.clean) {
    await fs.remove(target);
  }

  await fs.mkdirs(target);
  await fs.writeFile(path.join(target, '.gitignore'), `\n*\n`);

  await productionPack({
    packageDir: paths.targetDir,
    targetDir: target,
  });

  // 3. Customize Package.json
  Task.log(
    `Customizing main package in ${chalk.cyan(
      path.join(targetRelativePath, 'package.json'),
    )} for dynamic loading`,
  );

  if (
    files &&
    Array.isArray(files) &&
    !files.includes('dist-scalprum') &&
    opts.generateScalprumAssets
  ) {
    files.push('dist-scalprum');
  }

  const monoRepoPackages = await getPackages(paths.targetDir);
  await customizeForDynamicUse({
    embedded: [],
    isYarnV1: false,
    monoRepoPackages,
    overriding: {
      name: `${name}-dynamic`,
      scripts: {}, // Scripts removed to avoid npm pack triggers
      files,
    },
  })(path.resolve(target, 'package.json'));

  // 4. Generate Scalprum Assets
  await generateScalprumAssets(opts, target, name, version, scalprumInline);

  // 5. Handle Yarn Install / Lockfile
  await handlePackageInstall(opts, target);

  return target;
}

async function generateModuleFederationAssets(opts: OptionValues) {
  if (!opts.generateModuleFederationAssets) return;

  if (opts.clean) {
    await fs.remove(path.join(paths.targetDir, 'dist'));
  }

  Task.log(
    `Generating standard module federation assets in ${chalk.cyan(
      path.join(paths.targetDir, 'dist'),
    )}`,
  );
  await buildFrontend({
    targetDir: paths.targetDir,
    configPaths: [],
    writeStats: false,
    isModuleFederationRemote: true,
  });
}

async function resolveScalprumConfig(
  opts: OptionValues,
  scalprumInline: any,
  name: string,
) {
  if (opts.scalprumConfig) {
    const scalprumConfigFile = paths.resolveTarget(opts.scalprumConfig);
    Task.log(
      `Using external scalprum config file: ${chalk.cyan(scalprumConfigFile)}`,
    );
    return fs.readJson(scalprumConfigFile);
  }

  if (scalprumInline) {
    Task.log(`Using scalprum config inlined in the 'package.json'`);
    return scalprumInline;
  }

  // Default configuration generation
  let scalprumName;
  if (name.includes('/')) {
    const fragments = name.split('/');
    scalprumName = `${fragments[0].replace('@', '')}.${fragments[1]}`;
  } else {
    scalprumName = name;
  }

  const defaultScalprum = {
    name: scalprumName,
    exposedModules: {
      PluginRoot: './src/index.ts',
    },
  };

  Task.log(`No scalprum config. Using default dynamic UI configuration:`);
  Task.log(chalk.cyan(JSON.stringify(defaultScalprum, null, 2)));
  Task.log(
    `If you wish to change the defaults, add "scalprum" configuration to plugin "package.json" file, or use the '--scalprum-config' option to specify an external config.`,
  );
  return defaultScalprum;
}

async function generateScalprumAssets(
  opts: OptionValues,
  target: string,
  name: string,
  version: string,
  scalprumInline: any,
) {
  if (!opts.generateScalprumAssets) return;

  const resolvedScalprumDistPath = path.join(target, 'dist-scalprum');
  Task.log(
    `Generating dynamic frontend plugin assets in ${chalk.cyan(
      resolvedScalprumDistPath,
    )}`,
  );

  const scalprum = await resolveScalprumConfig(opts, scalprumInline, name);

  await fs.remove(resolvedScalprumDistPath);

  await buildScalprumPlugin({
    writeStats: false,
    configPaths: [],
    targetDir: paths.targetDir,
    pluginMetadata: {
      ...scalprum,
      version,
    },
    resolvedScalprumDistPath,
  });
}

async function handlePackageInstall(opts: OptionValues, target: string) {
  const yarn = 'yarn';
  const yarnVersion = execSync(`${yarn} --version`).toString().trim(); // NOSONAR
  const yarnLock = path.resolve(target, 'yarn.lock');
  const yarnLockExists = await fs.pathExists(yarnLock);

  if (!yarnLockExists) {
    await locateAndCopyYarnLock({
      targetDir: paths.targetDir,
      targetRoot: paths.targetRoot,
      yarnLock,
    });
  }

  if (!opts.install) {
    Task.log(
      chalk.yellow(
        `Last export step (${chalk.cyan(
          'yarn install',
        )} has been disabled: the dynamic plugin package ${chalk.cyan(
          'yarn.lock',
        )} file will be inconsistent until ${chalk.cyan(
          'yarn install',
        )} is run manually`,
      ),
    );
    return;
  }

  Task.log(
    `${yarnLockExists ? 'Verifying' : 'Creating'} filtered yarn.lock file for the exported package`,
  );

  const logFile = 'yarn-install.log';
  const redirect = `> ${logFile}`;
  const yarnInstall = yarnVersion.startsWith('1.')
    ? `${yarn} install --production${
        yarnLockExists ? ' --frozen-lockfile' : ''
      } ${redirect}`
    : `${yarn} install${yarnLockExists ? ' --immutable' : ' --no-immutable'} ${redirect}`;

  await Task.forCommand(yarnInstall, { cwd: target, optional: false });
  await fs.remove(paths.resolveTarget('dist-dynamic', '.yarn'));
  await fs.remove(paths.resolveTarget('dist-dynamic', logFile));
}

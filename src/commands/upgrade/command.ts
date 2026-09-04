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

import { BACKSTAGE_JSON } from '@backstage/cli-common';
import chalk from 'chalk';
import { OptionValues } from 'commander';
import fs from 'fs-extra';
import path from 'node:path';
import { paths } from '../../lib/paths';
import { resolveRhdhVersion } from '../../lib/rhdhVersion';
import { runPlain } from '../../lib/run';
import { Task } from '../../lib/tasks';

export type DependencySection =
  | 'dependencies'
  | 'devDependencies'
  | 'peerDependencies';

export interface PackageUpgradeChange {
  name: string;
  section: DependencySection;
  current: string;
  target: string;
  changed: boolean;
}

export interface UpgradePluginOptions {
  rhdhVersion?: string;
  dryRun?: boolean;
  skipInstall?: boolean;
  manifestFile?: string;
  json?: boolean;
  targetDir?: string;
}

export interface UpgradePluginResult {
  rhdhVersion: string;
  backstageVersion: string;
  source: 'remote' | 'matrix';
  changes: PackageUpgradeChange[];
  unmanifested: string[];
  updatedFiles: string[];
  installed: boolean;
}

/**
 * Computes the target version string preserving existing range specifier (^, ~) or exact pin
 */
export function computeTargetVersion(
  currentDeclared: string,
  manifestExpected: string,
): string {
  if (currentDeclared === 'backstage:^') {
    return 'backstage:^';
  }

  if (currentDeclared.startsWith('^')) {
    return `^${manifestExpected}`;
  }

  if (currentDeclared.startsWith('~')) {
    return `~${manifestExpected}`;
  }

  return manifestExpected;
}

/**
 * Detects whether the project uses yarn or npm
 */
export async function detectPackageManager(
  targetDir: string,
): Promise<'yarn' | 'npm'> {
  const possibleYarnLocks = [
    path.join(targetDir, 'yarn.lock'),
    path.join(paths.targetRoot, 'yarn.lock'),
  ];

  for (const lockPath of possibleYarnLocks) {
    if (await fs.pathExists(lockPath)) {
      return 'yarn';
    }
  }

  return 'npm';
}

/**
 * Applies upgrades across all dependency sections in package.json
 */
function applyDependencyUpgrades(
  packageJson: Record<string, any>,
  manifestPackages: Map<string, string>,
): {
  changes: PackageUpgradeChange[];
  unmanifested: string[];
  modified: boolean;
} {
  const sections: DependencySection[] = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
  ];

  const changes: PackageUpgradeChange[] = [];
  const unmanifested: string[] = [];
  let modified = false;

  for (const section of sections) {
    const deps = packageJson[section] as Record<string, string> | undefined;
    if (!deps) continue;

    for (const [name, currentVersion] of Object.entries(deps)) {
      const isBackstagePkg = name.startsWith('@backstage/');
      const manifestExpected = manifestPackages.get(name);

      if (!isBackstagePkg && !manifestExpected) {
        continue;
      }

      if (!manifestExpected) {
        unmanifested.push(name);
        continue;
      }

      const targetVersion = computeTargetVersion(
        currentVersion,
        manifestExpected,
      );
      const isChanged = currentVersion !== targetVersion;

      changes.push({
        name,
        section,
        current: currentVersion,
        target: targetVersion,
        changed: isChanged,
      });

      if (isChanged) {
        packageJson[section][name] = targetVersion;
        modified = true;
      }
    }
  }

  return { changes, unmanifested, modified };
}

/**
 * Synchronizes backstage.json with target Backstage version if present
 */
async function syncBackstageJson(
  targetDir: string,
  targetBackstageVersion: string,
): Promise<string | undefined> {
  const backstageJsonPath = path.join(targetDir, BACKSTAGE_JSON);
  if (!(await fs.pathExists(backstageJsonPath))) {
    return undefined;
  }

  try {
    const backstageJson = await fs.readJson(backstageJsonPath);
    if (backstageJson.version !== targetBackstageVersion) {
      backstageJson.version = targetBackstageVersion;
      await fs.writeJson(backstageJsonPath, backstageJson, { spaces: 2 });
      return BACKSTAGE_JSON;
    }
  } catch {
    // Ignore JSON read errors
  }
  return undefined;
}

/**
 * Executes package manager install in target directory
 */
async function runInstallDependencies(targetDir: string): Promise<boolean> {
  const pm = await detectPackageManager(targetDir);
  try {
    await Task.forItem('installing', 'dependencies', async () => {
      await runPlain(pm, 'install');
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Upgrades @backstage/* dependencies in a package.json to match target RHDH release manifest
 */
export async function upgradePluginDependencies(
  options: UpgradePluginOptions = {},
): Promise<UpgradePluginResult> {
  const targetDir = options.targetDir || paths.targetDir;
  const packageJsonPath = path.join(targetDir, 'package.json');

  if (!(await fs.pathExists(packageJsonPath))) {
    throw new Error(
      `No package.json found at "${targetDir}". Make sure you run this command inside a plugin package directory.`,
    );
  }

  const packageJson = await fs.readJson(packageJsonPath);
  const resolved = await resolveRhdhVersion(options.rhdhVersion, {
    manifestFile: options.manifestFile,
  });

  const { changes, unmanifested, modified } = applyDependencyUpgrades(
    packageJson,
    resolved.packages,
  );

  const updatedFiles: string[] = [];
  let installed = false;

  if (!options.dryRun) {
    if (modified) {
      await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });
      updatedFiles.push('package.json');
    }

    const updatedBsJson = await syncBackstageJson(
      targetDir,
      resolved.backstageVersion,
    );
    if (updatedBsJson) {
      updatedFiles.push(updatedBsJson);
    }

    if (!options.skipInstall && modified) {
      installed = await runInstallDependencies(targetDir);
    }
  }

  return {
    rhdhVersion: resolved.rhdhVersion,
    backstageVersion: resolved.backstageVersion,
    source: resolved.source,
    changes,
    unmanifested,
    updatedFiles,
    installed,
  };
}

/**
 * CLI command entry point for `rhdh-cli plugin upgrade`
 */
export async function command(
  rhdhVersionArg?: string,
  opts: OptionValues = {},
): Promise<void> {
  const rhdhVersion = rhdhVersionArg || opts.rhdhVersion;
  const { dryRun, skipInstall, manifestFile, json } = opts;

  const result = await upgradePluginDependencies({
    rhdhVersion,
    dryRun,
    skipInstall,
    manifestFile,
    json,
  });

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const modeLabel = dryRun ? ' (dry run)' : '';
  Task.log(
    `Upgrading plugin dependencies to RHDH v${result.rhdhVersion} (Backstage v${result.backstageVersion}) [${result.source}]${modeLabel}...`,
  );

  if (result.changes.length === 0) {
    Task.log('No @backstage dependencies found to upgrade.');
    return;
  }

  process.stderr.write('\n');

  const colNameWidth = Math.max(
    ...result.changes.map(c => c.name.length),
    'Package'.length,
  );
  const colSecWidth = Math.max(
    ...result.changes.map(c => c.section.length),
    'Section'.length,
  );
  const colCurWidth = Math.max(
    ...result.changes.map(c => c.current.length),
    'Current'.length,
  );
  const colTarWidth = Math.max(
    ...result.changes.map(c => c.target.length),
    'Target'.length,
  );

  const header = `${'Package'.padEnd(colNameWidth)}  ${'Section'.padEnd(colSecWidth)}  ${'Current'.padEnd(colCurWidth)}  ${'Target'.padEnd(colTarWidth)}  Status`;
  process.stderr.write(`${chalk.bold(header)}\n`);
  process.stderr.write(
    `${chalk.gray('-'.repeat(header.length + '  Status'.length))}\n`,
  );

  for (const change of result.changes) {
    const statusLabel = change.changed
      ? chalk.yellow('↻ updated')
      : chalk.green('✓ unchanged');

    const line = `${change.name.padEnd(colNameWidth)}  ${change.section.padEnd(colSecWidth)}  ${change.current.padEnd(colCurWidth)}  ${change.target.padEnd(colTarWidth)}  ${statusLabel}`;
    process.stderr.write(`${line}\n`);
  }

  process.stderr.write('\n');

  const changedCount = result.changes.filter(c => c.changed).length;
  const unchangedCount = result.changes.filter(c => !c.changed).length;

  const updatedStr = chalk.yellow(`↻ ${changedCount} updated`);
  const unchangedStr = chalk.green(`✓ ${unchangedCount} unchanged`);
  const summary = `${updatedStr}, ${unchangedStr} (${result.changes.length} total)`;
  process.stderr.write(`${chalk.bold('Summary:')} ${summary}\n`);

  if (result.unmanifested.length > 0) {
    const unmanCountStr = chalk.yellow(
      `${result.unmanifested.length} unmanifested`,
    );
    process.stderr.write(
      `\n${chalk.yellow('Warning:')} Found ${unmanCountStr} @backstage packages not present in the release manifest: ${result.unmanifested.join(', ')}\n`,
    );
  }

  if (dryRun) {
    process.stderr.write(
      `\n${chalk.cyan('Dry run completed:')} No files were modified on disk.\n\n`,
    );
  } else if (result.updatedFiles.length > 0) {
    const filesStr = chalk.cyan(result.updatedFiles.join(', '));
    process.stderr.write(
      `\n${chalk.green('✔ Successfully upgraded')} ${filesStr}.\n\n`,
    );
  } else {
    process.stderr.write(
      `\n${chalk.green('✔ All dependencies are already up to date.')}\n\n`,
    );
  }
}

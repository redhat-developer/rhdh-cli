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
import { OptionValues } from 'commander';
import fs from 'fs-extra';
import path from 'node:path';
import semver from 'semver';
import { paths } from '../../lib/paths';
import { resolveRhdhVersion } from '../../lib/rhdhVersion';
import { Task } from '../../lib/tasks';

export type DependencyStatus = 'match' | 'mismatch' | 'unmanifested';
export type DependencySection =
  | 'dependencies'
  | 'devDependencies'
  | 'peerDependencies';

export interface PackageCheckResult {
  name: string;
  section: DependencySection;
  declared: string;
  expected?: string;
  status: DependencyStatus;
}

export interface CheckVersionsResult {
  rhdhVersion: string;
  backstageVersion: string;
  source: 'remote' | 'matrix';
  valid: boolean;
  counts: {
    matching: number;
    mismatched: number;
    unmanifested: number;
    total: number;
  };
  packages: PackageCheckResult[];
}

export interface CheckVersionsOptions {
  rhdhVersion?: string;
  manifestFile?: string;
  json?: boolean;
  targetDir?: string;
}

/**
 * Determines if a declared version string is aligned with the manifest expected version
 */
function isVersionAligned(
  declaredVersion: string,
  expectedVersion: string,
): boolean {
  if (declaredVersion === 'backstage:^') {
    return true;
  }

  const cleanedDeclared = declaredVersion.replace(/^[\^~]/, '');
  if (cleanedDeclared === expectedVersion) {
    return true;
  }

  const parsedDeclared = semver.clean(declaredVersion);
  return parsedDeclared === expectedVersion;
}

/**
 * Audits a single dependency against the Backstage release manifest
 */
function auditDependency(
  name: string,
  declaredVersion: string,
  section: DependencySection,
  manifestPackages: Map<string, string>,
): PackageCheckResult | undefined {
  const isBackstagePkg = name.startsWith('@backstage/');
  const expectedVersion = manifestPackages.get(name);

  if (!isBackstagePkg && !expectedVersion) {
    return undefined;
  }

  if (!expectedVersion) {
    return {
      name,
      section,
      declared: declaredVersion,
      status: 'unmanifested',
    };
  }

  const isMatch = isVersionAligned(declaredVersion, expectedVersion);
  return {
    name,
    section,
    declared: declaredVersion,
    expected: expectedVersion,
    status: isMatch ? 'match' : 'mismatch',
  };
}

/**
 * Checks dependency alignment for a package.json against a target RHDH version
 */
export async function checkPluginDependencies(
  options: CheckVersionsOptions = {},
): Promise<CheckVersionsResult> {
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

  const sections: DependencySection[] = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
  ];

  const packages: PackageCheckResult[] = [];

  for (const section of sections) {
    const deps = packageJson[section] as Record<string, string> | undefined;
    if (!deps) continue;

    for (const [name, declaredVersion] of Object.entries(deps)) {
      const audited = auditDependency(
        name,
        declaredVersion,
        section,
        resolved.packages,
      );
      if (audited) {
        packages.push(audited);
      }
    }
  }

  const matching = packages.filter(p => p.status === 'match').length;
  const mismatched = packages.filter(p => p.status === 'mismatch').length;
  const unmanifested = packages.filter(p => p.status === 'unmanifested').length;
  const valid = mismatched === 0 && unmanifested === 0;

  return {
    rhdhVersion: resolved.rhdhVersion,
    backstageVersion: resolved.backstageVersion,
    source: resolved.source,
    valid,
    counts: {
      matching,
      mismatched,
      unmanifested,
      total: packages.length,
    },
    packages,
  };
}

/**
 * CLI command entry point for `rhdh-cli plugin check-versions`
 */
export async function command(opts: OptionValues): Promise<void> {
  const { rhdhVersion, manifestFile, json } = opts;

  const result = await checkPluginDependencies({
    rhdhVersion,
    manifestFile,
    json,
  });

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.valid) {
      process.exitCode = 1;
    }
    return;
  }

  Task.log(
    `Checking plugin dependencies against RHDH v${result.rhdhVersion} (Backstage v${result.backstageVersion}) [${result.source}]...`,
  );

  if (result.packages.length === 0) {
    Task.log('No @backstage dependencies found in package.json.');
    return;
  }

  process.stderr.write('\n');

  // Calculate column widths for clean tabular output
  const colNameWidth = Math.max(
    ...result.packages.map(p => p.name.length),
    'Package'.length,
  );
  const colSecWidth = Math.max(
    ...result.packages.map(p => p.section.length),
    'Section'.length,
  );
  const colDeclWidth = Math.max(
    ...result.packages.map(p => p.declared.length),
    'Declared'.length,
  );
  const colExpWidth = Math.max(
    ...result.packages.map(p => (p.expected || '-').length),
    'Expected'.length,
  );

  const header = `${'Package'.padEnd(colNameWidth)}  ${'Section'.padEnd(colSecWidth)}  ${'Declared'.padEnd(colDeclWidth)}  ${'Expected'.padEnd(colExpWidth)}  Status`;
  process.stderr.write(`${chalk.bold(header)}\n`);
  process.stderr.write(
    `${chalk.gray('-'.repeat(header.length + '  Status'.length))}\n`,
  );

  for (const pkg of result.packages) {
    let statusLabel: string;
    if (pkg.status === 'match') {
      statusLabel = chalk.green('✓ match');
    } else if (pkg.status === 'mismatch') {
      statusLabel = chalk.red('✗ mismatch');
    } else {
      statusLabel = chalk.yellow('⚠ unmanifested');
    }

    const line = `${pkg.name.padEnd(colNameWidth)}  ${pkg.section.padEnd(colSecWidth)}  ${pkg.declared.padEnd(colDeclWidth)}  ${(pkg.expected || '-').padEnd(colExpWidth)}  ${statusLabel}`;
    process.stderr.write(`${line}\n`);
  }

  process.stderr.write('\n');

  // Summary line without nested template literals
  const matchStr = chalk.green(`✓ ${result.counts.matching} matching`);
  const mismatchStr = chalk.red(`✗ ${result.counts.mismatched} mismatched`);
  const unmanifestedStr = chalk.yellow(
    `⚠ ${result.counts.unmanifested} unmanifested`,
  );
  const summary = `${matchStr}, ${mismatchStr}, ${unmanifestedStr} (${result.counts.total} total)`;
  process.stderr.write(`${chalk.bold('Summary:')} ${summary}\n`);

  if (!result.valid) {
    const upgradeCmd = chalk.cyan(
      `rhdh-cli plugin upgrade ${result.rhdhVersion}`,
    );
    process.stderr.write(
      `\n${chalk.yellow('Remediation:')} Run ${upgradeCmd} to align dependencies with RHDH v${result.rhdhVersion}.\n\n`,
    );
    process.exitCode = 1;
  } else {
    process.stderr.write(
      `\n${chalk.green('✔ All @backstage dependencies are aligned with target RHDH release.')}\n\n`,
    );
  }
}

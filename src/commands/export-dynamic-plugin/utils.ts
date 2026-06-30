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

import { BackstagePackageJson } from '@backstage/cli-node';

import { Packages } from '@manypkg/get-packages';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as semver from 'semver';

import {
  isBackstageVersionSpec,
  resolveBackstageVersion,
} from '../../lib/backstageVersion';
import { Task } from '../../lib/tasks';

export type ResolvedEmbedded = {
  packageName: string;
  version: string;
  dir: string;
  parentPackageName: string;
  alreadyPacked: boolean;
};

type SharedPackagesRules = {
  include: (string | RegExp)[];
  exclude: (string | RegExp)[];
};

function checkWorkspacePackageVersion(
  requiredVersionSpec: string,
  pkg: { version: string; dir: string },
): boolean {
  const versionDetail = requiredVersionSpec.replace(/^workspace:/, '');

  return (
    pkg.dir === versionDetail ||
    versionDetail === '*' ||
    versionDetail === '~' ||
    versionDetail === '^' ||
    semver.satisfies(pkg.version, versionDetail)
  );
}

/**
 * Resolves workspace: and backstage: protocol version specs to concrete versions.
 *
 * - workspace:^ / workspace:~ / workspace:* => lookup in embedded, then monoRepoPackages
 * - backstage:^ => delegate to resolveBackstageVersion()
 * - anything else => undefined (no transformation needed)
 *
 * Preserves the range prefix: workspace:^ => ^1.5.0, workspace:~ => ~1.5.0,
 * workspace:* => 1.5.0, backstage:^ => ^1.5.0.
 */
async function resolveProtocolVersion(
  dep: string,
  versionSpec: string,
  embedded: ResolvedEmbedded[],
  monoRepoPackages: Packages | undefined,
  contextPkgName: string,
): Promise<{ resolved: string; exact: string } | undefined> {
  if (versionSpec.startsWith('workspace:')) {
    let resolvedVersion: string | undefined;
    const rangeSpecifier = versionSpec.replace(/^workspace:/, '');
    const embeddedDep = embedded.find(
      e =>
        e.packageName === dep && checkWorkspacePackageVersion(versionSpec, e),
    );
    if (embeddedDep) {
      resolvedVersion = embeddedDep.version;
    } else if (monoRepoPackages) {
      const relatedMonoRepoPackages = monoRepoPackages.packages.filter(
        p => p.packageJson.name === dep,
      );
      if (relatedMonoRepoPackages.length > 1) {
        throw new Error(
          `Two packages named ${chalk.cyan(
            dep,
          )} exist in the monorepo structure: this is not supported.`,
        );
      }
      if (
        relatedMonoRepoPackages.length === 1 &&
        checkWorkspacePackageVersion(versionSpec, {
          dir: relatedMonoRepoPackages[0].dir,
          version: relatedMonoRepoPackages[0].packageJson.version,
        })
      ) {
        resolvedVersion = relatedMonoRepoPackages[0].packageJson.version;
      }
    }

    if (!resolvedVersion) {
      throw new Error(
        `Workspace dependency ${chalk.cyan(dep)} of package ${chalk.cyan(
          contextPkgName,
        )} doesn't exist in the monorepo structure: maybe you should embed it ?`,
      );
    }

    const exact = resolvedVersion;
    if (rangeSpecifier === '^' || rangeSpecifier === '~') {
      resolvedVersion = rangeSpecifier + resolvedVersion;
    }
    return { resolved: resolvedVersion, exact };
  }

  if (isBackstageVersionSpec(versionSpec)) {
    const resolvedVersion = await resolveBackstageVersion(dep, versionSpec);
    if (resolvedVersion) {
      Task.log(
        `  resolving ${chalk.cyan(dep)} from ${chalk.yellow(
          versionSpec,
        )} to ${chalk.green(resolvedVersion)}`,
      );
      const exact = resolvedVersion.replace(/^[\^~]/, '');
      return { resolved: resolvedVersion, exact };
    }
  }

  return undefined;
}

function isPackageShared(
  pkgName: string,
  rules: SharedPackagesRules | undefined,
) {
  function test(str: string, expr: string | RegExp): boolean {
    if (typeof expr === 'string') {
      return str === expr;
    }
    return expr.test(str);
  }

  if ((rules?.exclude || []).some(dontMove => test(pkgName, dontMove))) {
    return false;
  }

  if ((rules?.include || []).some(move => test(pkgName, move))) {
    return true;
  }

  return false;
}

export function customizeForDynamicUse(options: {
  embedded: ResolvedEmbedded[];
  isYarnV1: boolean;
  monoRepoPackages?: Packages;
  sharedPackages?: SharedPackagesRules;
  overridding?:
    | (Partial<BackstagePackageJson> & {
        bundleDependencies?: boolean;
      })
    ;
  additionalOverrides?: { [key: string]: any };
  additionalResolutions?: { [key: string]: any };
  after?: ((pkg: BackstagePackageJson) => void);
}): (dynamicPkgPath: string) => Promise<void> {
  return async (dynamicPkgPath: string): Promise<void> => {
    const dynamicPkgContent = await fs.readFile(dynamicPkgPath, 'utf8');
    const pkgToCustomize = JSON.parse(
      dynamicPkgContent,
    ) as BackstagePackageJson;

    for (const field in options.overridding || {}) {
      if (!Object.prototype.hasOwnProperty.call(options.overridding, field)) {
        continue;
      }
      (pkgToCustomize as any)[field] = (options.overridding as any)[field];
    }

    pkgToCustomize.files = pkgToCustomize.files?.filter(
      f => !f.startsWith('dist-dynamic/'),
    );

    // Collect exact versions for pinning in resolutions
    const pinnedResolutions: Record<string, string> = {};
    const embeddedNames = new Set(options.embedded.map(e => e.packageName));

    // Resolve workspace: and backstage: in dependencies
    if (pkgToCustomize.dependencies) {
      for (const dep in pkgToCustomize.dependencies) {
        if (
          !Object.prototype.hasOwnProperty.call(
            pkgToCustomize.dependencies,
            dep,
          )
        ) {
          continue;
        }

        const dependencyVersionSpec = pkgToCustomize.dependencies[dep];
        const result = await resolveProtocolVersion(
          dep,
          dependencyVersionSpec,
          options.embedded,
          options.monoRepoPackages,
          pkgToCustomize.name,
        );
        if (result) {
          pkgToCustomize.dependencies[dep] = result.resolved;
          if (!embeddedNames.has(dep)) {
            pinnedResolutions[dep] = result.exact;
          }
        }

        if (isPackageShared(dep, options.sharedPackages)) {
          Task.log(`  moving ${chalk.cyan(dep)} to peerDependencies`);

          pkgToCustomize.peerDependencies ||= {};
          pkgToCustomize.peerDependencies[dep] =
            pkgToCustomize.dependencies[dep];
          delete pkgToCustomize.dependencies[dep];

          continue;
        }

        // If yarn v1, then detect if the current dep is an embedded one,
        // and if it is the case replace the version by the file protocol
        // (like what we do for the resolutions).
        if (options.isYarnV1) {
          const embeddedDep = options.embedded.find(
            e =>
              e.packageName === dep &&
              checkWorkspacePackageVersion(dependencyVersionSpec, e),
          );
          if (embeddedDep) {
            pkgToCustomize.dependencies[dep] =
              `file:./${embeddedPackageRelativePath(embeddedDep)}`;
          }
        }
      }
    }

    // Resolve workspace: and backstage: in pre-existing peerDependencies
    if (pkgToCustomize.peerDependencies) {
      for (const dep in pkgToCustomize.peerDependencies) {
        if (
          !Object.prototype.hasOwnProperty.call(
            pkgToCustomize.peerDependencies,
            dep,
          )
        )
          continue;
        const result = await resolveProtocolVersion(
          dep,
          pkgToCustomize.peerDependencies[dep],
          options.embedded,
          options.monoRepoPackages,
          pkgToCustomize.name,
        );
        if (result) {
          pkgToCustomize.peerDependencies[dep] = result.resolved;
          if (!embeddedNames.has(dep)) {
            pinnedResolutions[dep] = result.exact;
          }
        }
      }
    }

    // Pin transitive workspace:/backstage: deps reachable from direct deps.
    // Without pinning, yarn resolves these from npm (workspace: lockfile entries
    // cannot seed npm: entries in dist-dynamic), causing version drift.
    if (options.monoRepoPackages) {
      const wsPackagesByName = new Map(
        options.monoRepoPackages.packages.map(p => [p.packageJson.name, p]),
      );
      const queue = Object.keys(pinnedResolutions);
      const visited = new Set<string>(queue);

      while (queue.length > 0) {
        const pkgName = queue.pop()!;
        const wsPkg = wsPackagesByName.get(pkgName);
        if (!wsPkg) continue;

        const allDeps: Record<string, string> = {
          ...wsPkg.packageJson.dependencies,
          ...wsPkg.packageJson.peerDependencies,
        };
        for (const [depName, depVersion] of Object.entries(allDeps)) {
          if (visited.has(depName)) continue;
          visited.add(depName);

          const isProtocol =
            depVersion.startsWith('workspace:') ||
            depVersion.startsWith('backstage:');
          if (!isProtocol) continue;
          if (embeddedNames.has(depName)) continue;

          const depPkg = wsPackagesByName.get(depName);
          if (depPkg) {
            pinnedResolutions[depName] = depPkg.packageJson.version;
            queue.push(depName);
          }
        }
      }
    }

    pkgToCustomize.devDependencies = {};

    const overrides = (pkgToCustomize as any).overrides || {};
    (pkgToCustomize as any).overrides = {
      '@aws-sdk/util-utf8-browser': {
        '@smithy/util-utf8': '^2.0.0',
      },
      ...overrides,
      ...(options.additionalOverrides || {}),
    };
    const resolutions = (pkgToCustomize as any).resolutions || {};
    (pkgToCustomize as any).resolutions = {
      '@aws-sdk/util-utf8-browser': 'npm:@smithy/util-utf8@~2',
      ...pinnedResolutions,
      ...resolutions,
      ...(options.additionalResolutions || {}),
    };

    if (options.after) {
      options.after(pkgToCustomize);
    }

    await fs.writeJson(dynamicPkgPath, pkgToCustomize, {
      encoding: 'utf8',
      spaces: 2,
    });
  };
}

function embeddedPackageRelativePath(p: ResolvedEmbedded): string {
  return `embedded/${p.packageName.replace(/^@/, '').replace(/\//, '-')}`;
}

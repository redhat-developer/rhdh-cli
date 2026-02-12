import chalk from 'chalk';
import fs from 'fs-extra';

import path from 'node:path';
import { BackstagePackageJson } from '@backstage/cli-node';

import { Packages } from '@manypkg/get-packages';
import * as semver from 'semver';
import { ResolvedEmbedded, SharedPackagesRules } from './types';
import { Task } from '../../lib/tasks';

export function checkWorkspacePackageVersion(
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

export function customizeForDynamicUse(options: {
  embedded: ResolvedEmbedded[];
  isYarnV1: boolean;
  monoRepoPackages?: Packages;
  sharedPackages?: SharedPackagesRules;
  overriding?: Partial<BackstagePackageJson> & {
    bundleDependencies?: boolean;
  };
  additionalOverrides?: { [key: string]: any };
  additionalResolutions?: { [key: string]: any };
  after?: (pkg: BackstagePackageJson) => void;
}): (dynamicPkgPath: string) => Promise<void> {
  return async (dynamicPkgPath: string): Promise<void> => {
    const dynamicPkgContent = await fs.readFile(dynamicPkgPath, 'utf8');
    const pkgToCustomize = JSON.parse(
      dynamicPkgContent,
    ) as BackstagePackageJson;

    for (const field in options.overriding || {}) {
      if (!Object.hasOwn(options.overriding || {}, field)) {
        continue;
      }
      (pkgToCustomize as any)[field] = (options.overriding as any)[field];
    }

    pkgToCustomize.files = pkgToCustomize.files?.filter(
      f => !f.startsWith('dist-dynamic/'),
    );

    if (pkgToCustomize.dependencies) {
      for (const dep in pkgToCustomize.dependencies) {
        if (!Object.hasOwn(pkgToCustomize.dependencies, dep)) {
          continue;
        }

        const dependencyVersionSpec = pkgToCustomize.dependencies[dep];
        if (dependencyVersionSpec.startsWith('workspace:')) {
          let resolvedVersion: string | undefined;
          const rangeSpecifier = dependencyVersionSpec.replace(
            /^workspace:/,
            '',
          );
          const embeddedDep = options.embedded.find(
            e =>
              e.packageName === dep &&
              checkWorkspacePackageVersion(dependencyVersionSpec, e),
          );
          if (embeddedDep) {
            resolvedVersion = embeddedDep.version;
          } else if (options.monoRepoPackages) {
            const relatedMonoRepoPackages =
              options.monoRepoPackages.packages.filter(
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
              checkWorkspacePackageVersion(dependencyVersionSpec, {
                dir: relatedMonoRepoPackages[0].dir,
                version: relatedMonoRepoPackages[0].packageJson.version,
              })
            ) {
              resolvedVersion =
                rangeSpecifier === '^' || rangeSpecifier === '~'
                  ? rangeSpecifier +
                    relatedMonoRepoPackages[0].packageJson.version
                  : relatedMonoRepoPackages[0].packageJson.version;
            }
          }

          if (!resolvedVersion) {
            throw new Error(
              `Workspace dependency ${chalk.cyan(dep)} of package ${chalk.cyan(
                pkgToCustomize.name,
              )} doesn't exist in the monorepo structure: maybe you should embed it ?`,
            );
          }

          pkgToCustomize.dependencies[dep] = resolvedVersion;
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

    // We remove devDependencies here since we want the dynamic plugin derived package
    // to get only production dependencies, and no transitive dependencies, in both
    // the node_modules sub-folder and yarn.lock file in `dist-dynamic`.
    //
    // And it happens that `yarn install --production` (yarn 1) doesn't completely
    // remove devDependencies as needed.
    //
    // See https://github.com/yarnpkg/yarn/issues/6373#issuecomment-760068356
    pkgToCustomize.devDependencies = {};

    // additionalOverrides and additionalResolutions will override the
    // current package.json entries for "overrides" and "resolutions"
    // respectively
    const overrides = (pkgToCustomize as any).overrides || {};
    (pkgToCustomize as any).overrides = {
      // The following lines are a workaround for the fact that the @aws-sdk/util-utf8-browser package
      // is not compatible with the NPM 9+, so that `npm pack` would not grab the Javascript files.
      // This package has been deprecated in favor of @smithy/util-utf8.
      //
      // See https://github.com/aws/aws-sdk-js-v3/issues/5305.
      '@aws-sdk/util-utf8-browser': {
        '@smithy/util-utf8': '^2.0.0',
      },
      ...overrides,
      ...(options.additionalOverrides || {}),
    };
    const resolutions = (pkgToCustomize as any).resolutions || {};
    (pkgToCustomize as any).resolutions = {
      // The following lines are a workaround for the fact that the @aws-sdk/util-utf8-browser package
      // is not compatible with the NPM 9+, so that `npm pack` would not grab the Javascript files.
      // This package has been deprecated in favor of @smithy/util-utf8.
      //
      // See https://github.com/aws/aws-sdk-js-v3/issues/5305.
      '@aws-sdk/util-utf8-browser': 'npm:@smithy/util-utf8@~2',
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

export async function locateAndCopyYarnLock({
  targetDir,
  targetRoot,
  yarnLock,
}: {
  targetDir: string;
  targetRoot: string;
  yarnLock: string;
}) {
  // Search the yarn.lock of the static plugin, possibly at the root of the monorepo.
  let staticPluginYarnLock: string | undefined;
  if (await fs.pathExists(path.join(targetDir, 'yarn.lock'))) {
    staticPluginYarnLock = path.join(targetDir, 'yarn.lock');
  } else if (await fs.pathExists(path.join(targetRoot, 'yarn.lock'))) {
    staticPluginYarnLock = path.join(targetRoot, 'yarn.lock');
  }
  if (!staticPluginYarnLock) {
    throw new Error(
      `Could not find the static plugin ${chalk.cyan(
        'yarn.lock',
      )} file in either the local folder or the monorepo root (${chalk.cyan(
        targetRoot,
      )})`,
    );
  }
  await fs.copyFile(staticPluginYarnLock, yarnLock);
}

export function isPackageShared(
  pkgName: string,
  rules: SharedPackagesRules | undefined,
) {
  const test = (str: string, expr: string | RegExp): boolean => {
    if (typeof expr === 'string') {
      return str === expr;
    }
    return expr.test(str);
  };

  if ((rules?.exclude || []).some(dontMove => test(pkgName, dontMove))) {
    return false;
  }

  if ((rules?.include || []).some(move => test(pkgName, move))) {
    return true;
  }

  return false;
}

export function embeddedPackageRelativePath(p: ResolvedEmbedded): string {
  return path.join(
    'embedded',
    p.packageName.replace(/^@/, '').replace(/\//, '-'),
  );
}

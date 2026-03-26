import chalk from 'chalk';
import fs from 'fs-extra';
import YAML from 'yaml';

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

export type CustomizeForDynamicUseOptions = {
  embedded: ResolvedEmbedded[];
  isYarnV1: boolean;
  monoRepoPackages?: Packages;
  sharedPackages?: SharedPackagesRules;
  overriding?: Partial<BackstagePackageJson> & {
    bundleDependencies?: boolean;
  };
  additionalOverrides?: { [key: string]: any };
  /** From lockfile-adjacent package.json; merged after packed manifest resolutions, before additionalResolutions. */
  workspaceResolutions?: { [key: string]: any };
  additionalResolutions?: { [key: string]: any };
  after?: (pkg: BackstagePackageJson) => void;
};

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

function resolveWorkspaceDependencyVersion(
  dep: string,
  dependencyVersionSpec: string,
  packageName: string | undefined,
  embedded: ResolvedEmbedded[],
  monoRepoPackages: Packages | undefined,
): string {
  const rangeSpecifier = dependencyVersionSpec.replace(/^workspace:/, '');
  const embeddedDep = embedded.find(
    e =>
      e.packageName === dep &&
      checkWorkspacePackageVersion(dependencyVersionSpec, e),
  );
  if (embeddedDep) {
    return embeddedDep.version;
  }
  if (!monoRepoPackages) {
    throw new Error(
      `Workspace dependency ${chalk.cyan(dep)} of package ${chalk.cyan(
        packageName ?? '',
      )} doesn't exist in the monorepo structure: maybe you should embed it ?`,
    );
  }
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
  if (relatedMonoRepoPackages.length === 0) {
    throw new Error(
      `Workspace dependency ${chalk.cyan(dep)} of package ${chalk.cyan(
        packageName ?? '',
      )} doesn't exist in the monorepo structure: maybe you should embed it ?`,
    );
  }
  const mono = relatedMonoRepoPackages[0];
  if (
    !checkWorkspacePackageVersion(dependencyVersionSpec, {
      dir: mono.dir,
      version: mono.packageJson.version,
    })
  ) {
    throw new Error(
      `Workspace dependency ${chalk.cyan(dep)} of package ${chalk.cyan(
        packageName ?? '',
      )} doesn't exist in the monorepo structure: maybe you should embed it ?`,
    );
  }
  return rangeSpecifier === '^' || rangeSpecifier === '~'
    ? rangeSpecifier + mono.packageJson.version
    : mono.packageJson.version;
}

function processDependencyForDynamicUse(
  dep: string,
  pkgToCustomize: BackstagePackageJson,
  options: CustomizeForDynamicUseOptions,
): void {
  const deps = pkgToCustomize.dependencies;
  if (!deps || !Object.hasOwn(deps, dep)) {
    return;
  }
  const specAtStart = deps[dep];

  if (specAtStart.startsWith('workspace:')) {
    deps[dep] = resolveWorkspaceDependencyVersion(
      dep,
      specAtStart,
      pkgToCustomize.name,
      options.embedded,
      options.monoRepoPackages,
    );
  }

  if (isPackageShared(dep, options.sharedPackages)) {
    Task.log(`  moving ${chalk.cyan(dep)} to peerDependencies`);
    pkgToCustomize.peerDependencies ||= {};
    pkgToCustomize.peerDependencies[dep] = deps[dep];
    delete deps[dep];
    return;
  }

  if (options.isYarnV1) {
    const embeddedDep = options.embedded.find(
      e =>
        e.packageName === dep && checkWorkspacePackageVersion(specAtStart, e),
    );
    if (embeddedDep) {
      deps[dep] = `file:./${embeddedPackageRelativePath(embeddedDep)}`;
    }
  }
}

function applyPackageJsonOverriding(
  pkgToCustomize: BackstagePackageJson,
  overriding: CustomizeForDynamicUseOptions['overriding'],
): void {
  if (!overriding) {
    return;
  }
  for (const field of Object.keys(overriding)) {
    if (!Object.hasOwn(overriding, field)) {
      continue;
    }
    (pkgToCustomize as any)[field] = (overriding as any)[field];
  }
}

function stripDistDynamicEntriesFromFiles(
  pkgToCustomize: BackstagePackageJson,
) {
  pkgToCustomize.files = pkgToCustomize.files?.filter(
    f => !f.startsWith('dist-dynamic/'),
  );
}

/** @aws-sdk/util-utf8-browser workaround — see https://github.com/aws/aws-sdk-js-v3/issues/5305 */
function mergeOverridesForDynamicPackage(
  pkgToCustomize: BackstagePackageJson,
  additionalOverrides: CustomizeForDynamicUseOptions['additionalOverrides'],
): void {
  const existing = (pkgToCustomize as any).overrides || {};
  const merged: Record<string, unknown> = {
    '@aws-sdk/util-utf8-browser': {
      '@smithy/util-utf8': '^2.0.0',
    },
    ...existing,
  };
  if (additionalOverrides) {
    Object.assign(merged, additionalOverrides);
  }
  (pkgToCustomize as any).overrides = merged;
}

/** Merge order: AWS workaround, packed manifest, workspace, additional (backend embed wins on conflicts). */
function mergeResolutionsForDynamicPackage(
  pkgToCustomize: BackstagePackageJson,
  workspaceResolutions: CustomizeForDynamicUseOptions['workspaceResolutions'],
  additionalResolutions: CustomizeForDynamicUseOptions['additionalResolutions'],
): void {
  const existing = (pkgToCustomize as any).resolutions || {};
  const merged: Record<string, unknown> = {
    '@aws-sdk/util-utf8-browser': 'npm:@smithy/util-utf8@~2',
    ...existing,
  };
  if (workspaceResolutions) {
    Object.assign(merged, workspaceResolutions);
  }
  if (additionalResolutions) {
    Object.assign(merged, additionalResolutions);
  }
  (pkgToCustomize as any).resolutions = merged;
}

export function customizeForDynamicUse(
  options: CustomizeForDynamicUseOptions,
): (dynamicPkgPath: string) => Promise<void> {
  return async (dynamicPkgPath: string): Promise<void> => {
    const dynamicPkgContent = await fs.readFile(dynamicPkgPath, 'utf8');
    const pkgToCustomize = JSON.parse(
      dynamicPkgContent,
    ) as BackstagePackageJson;

    applyPackageJsonOverriding(pkgToCustomize, options.overriding);
    stripDistDynamicEntriesFromFiles(pkgToCustomize);

    if (pkgToCustomize.dependencies) {
      for (const dep of Object.keys(pkgToCustomize.dependencies)) {
        processDependencyForDynamicUse(dep, pkgToCustomize, options);
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

    mergeOverridesForDynamicPackage(
      pkgToCustomize,
      options.additionalOverrides,
    );
    mergeResolutionsForDynamicPackage(
      pkgToCustomize,
      options.workspaceResolutions,
      options.additionalResolutions,
    );

    options.after?.(pkgToCustomize);

    await fs.writeJson(dynamicPkgPath, pkgToCustomize, {
      encoding: 'utf8',
      spaces: 2,
    });
  };
}

const YARN_RC_FILENAME = '.yarnrc.yml';

/** Milliseconds; standalone `dist-dynamic` installs can be slow on large lockfiles. */
const YARN_RC_EXPORT_HTTP_TIMEOUT = 300_000;

/** Extract Yarn release semver from a Berry `yarnPath` value (e.g. `.yarn/releases/yarn-4.8.1.cjs`). */
export function parseYarnVersionFromYarnPath(
  yarnPath: unknown,
): string | undefined {
  if (typeof yarnPath !== 'string') {
    return undefined;
  }
  const normalized = yarnPath.replaceAll('\\', '/');
  const m = /yarn-([^/]+)\.cjs$/.exec(normalized);
  return m?.[1];
}

/** Same discovery order as `initializeYarnProject` lockfile copy: plugin dir, then monorepo root. */
export async function resolveYarnLockSource(
  pluginPkgDir: string,
  monorepoRoot: string,
): Promise<string | undefined> {
  const localLock = path.join(pluginPkgDir, 'yarn.lock');
  if (await fs.pathExists(localLock)) {
    return localLock;
  }
  const rootLock = path.join(monorepoRoot, 'yarn.lock');
  if (await fs.pathExists(rootLock)) {
    return rootLock;
  }
  return undefined;
}

/** True when a resolution value cannot be reused in standalone dist-dynamic (monorepo protocols, nested shapes). */
export function shouldOmitWorkspaceResolutionValue(value: unknown): boolean {
  if (value === null) {
    return false;
  }
  if (typeof value === 'object') {
    return true;
  }
  if (typeof value !== 'string') {
    return false;
  }
  return /^\s*(workspace|portal|link):/i.test(value);
}

/**
 * Drops resolution entries that are not portable to a standalone Yarn project under dist-dynamic.
 * Returns keys that were omitted (for logging).
 */
export function filterWorkspaceResolutionsForDynamicExport(
  raw: Record<string, unknown>,
): { kept: Record<string, unknown>; omittedKeys: string[] } {
  const kept: Record<string, unknown> = {};
  const omittedKeys: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(raw, key)) {
      continue;
    }
    const val = raw[key];
    if (shouldOmitWorkspaceResolutionValue(val)) {
      omittedKeys.push(key);
      continue;
    }
    kept[key] = val;
  }
  return { kept, omittedKeys };
}

/**
 * Reads `resolutions` from the package.json next to the same yarn.lock used for export
 * (plugin package or monorepo root). Non-portable entries are omitted with a single Task.log warning.
 */
export async function loadResolutionsFromYarnLockWorkspace({
  pluginPkgDir,
  monorepoRoot,
}: {
  pluginPkgDir: string;
  monorepoRoot: string;
}): Promise<Record<string, unknown>> {
  const lockPath = await resolveYarnLockSource(pluginPkgDir, monorepoRoot);
  if (!lockPath) {
    return {};
  }
  const pkgJsonPath = path.join(path.dirname(lockPath), 'package.json');
  if (!(await fs.pathExists(pkgJsonPath))) {
    return {};
  }
  let pkg: unknown;
  try {
    pkg = await fs.readJson(pkgJsonPath);
  } catch {
    return {};
  }
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    return {};
  }
  const resolutions = (pkg as { resolutions?: unknown }).resolutions;
  if (
    !resolutions ||
    typeof resolutions !== 'object' ||
    Array.isArray(resolutions)
  ) {
    return {};
  }
  const { kept, omittedKeys } = filterWorkspaceResolutionsForDynamicExport(
    resolutions as Record<string, unknown>,
  );
  if (omittedKeys.length > 0) {
    Task.log(
      chalk.yellow(
        `Omitted ${omittedKeys.length} workspace ${chalk.cyan(
          'resolutions',
        )} from lockfile-adjacent ${chalk.cyan(
          'package.json',
        )} (not portable to dist-dynamic): ${chalk.cyan(
          [...omittedKeys]
            .sort((a, b) =>
              a.localeCompare(b, undefined, { sensitivity: 'base' }),
            )
            .join(', '),
        )}`,
      ),
    );
  }
  return kept;
}

async function resolveYarnRcSource(
  pluginPkgDir: string,
  monorepoRoot: string,
): Promise<string | undefined> {
  const localRc = path.join(pluginPkgDir, YARN_RC_FILENAME);
  if (await fs.pathExists(localRc)) {
    return localRc;
  }
  const rootRc = path.join(monorepoRoot, YARN_RC_FILENAME);
  if (await fs.pathExists(rootRc)) {
    return rootRc;
  }
  return undefined;
}

function yarnSemverForPackageManager(
  yarnPathSemver: string | undefined,
  yarnVersion: string,
): string {
  return yarnPathSemver ?? yarnVersion;
}

/**
 * Dynamic plugin exports run `yarn install` in dist-dynamic; Yarn Berry must use the
 * node-modules linker there (not PnP / other layouts from the monorepo).
 */
async function enforceBerryNodeModulesLinker(
  yarnRcDest: string,
  yarnVersion: string,
): Promise<void> {
  if (yarnVersion.startsWith('1.')) {
    return;
  }

  if (!(await fs.pathExists(yarnRcDest))) {
    await writeBerryStandaloneYarnRc(yarnRcDest);
    return;
  }

  const raw = await fs.readFile(yarnRcDest, 'utf8');
  const doc = YAML.parse(raw);
  if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
    const mapping = doc as Record<string, unknown>;
    if (mapping.nodeLinker === 'node-modules') {
      return;
    }
    mapping.nodeLinker = 'node-modules';
    await fs.writeFile(
      yarnRcDest,
      `${YAML.stringify(mapping).trimEnd()}\n`,
      'utf8',
    );
    return;
  }

  await writeBerryStandaloneYarnRc(yarnRcDest);
}

async function copyYarnLockWhenNeeded(
  copyYarnLockIfMissing: boolean,
  yarnLockDest: string,
  pluginPkgDir: string,
  monorepoRoot: string,
): Promise<void> {
  if (!copyYarnLockIfMissing || (await fs.pathExists(yarnLockDest))) {
    return;
  }
  const lockSource = await resolveYarnLockSource(pluginPkgDir, monorepoRoot);
  if (!lockSource) {
    throw new Error(
      `Could not find the static plugin ${chalk.cyan(
        'yarn.lock',
      )} file in either the local folder or the monorepo root (${chalk.cyan(
        monorepoRoot,
      )})`,
    );
  }
  await fs.copyFile(lockSource, yarnLockDest);
}

function yarnPathSemverFromYamlDoc(doc: unknown): string | undefined {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return undefined;
  }
  return parseYarnVersionFromYarnPath(
    (doc as Record<string, unknown>).yarnPath,
  );
}

async function tryYarnPathSemverFromRcPath(
  rcPath: string,
): Promise<string | undefined> {
  if (!(await fs.pathExists(rcPath))) {
    return undefined;
  }
  try {
    const raw = await fs.readFile(rcPath, 'utf8');
    return yarnPathSemverFromYamlDoc(YAML.parse(raw));
  } catch {
    return undefined;
  }
}

/**
 * Semver for `package.json#packageManager` only (read-only). Does not copy workspace `.yarnrc.yml`.
 */
async function yarnPathSemverForExportPackageManager(
  yarnRcDest: string,
  pluginPkgDir: string,
  monorepoRoot: string,
  yarnVersion: string,
): Promise<string | undefined> {
  if (yarnVersion.startsWith('1.')) {
    return undefined;
  }
  const fromExportTree = await tryYarnPathSemverFromRcPath(yarnRcDest);
  if (fromExportTree) {
    return fromExportTree;
  }
  const rcSource = await resolveYarnRcSource(pluginPkgDir, monorepoRoot);
  if (!rcSource) {
    return undefined;
  }
  return tryYarnPathSemverFromRcPath(rcSource);
}

/** Minimal Berry config for standalone `dist-dynamic` (no monorepo plugins / `.yarn/plugins`). */
async function writeBerryStandaloneYarnRc(yarnRcDest: string): Promise<void> {
  await fs.writeFile(
    yarnRcDest,
    `${YAML.stringify({
      httpTimeout: YARN_RC_EXPORT_HTTP_TIMEOUT,
      nodeLinker: 'node-modules',
    }).trimEnd()}\n`,
    'utf8',
  );
}

/**
 * Prepares a standalone Yarn project layout under `exportDir`: optional lockfile copy,
 * generated minimal `.yarnrc.yml` for Yarn Berry, `nodeLinker: node-modules`, and `packageManager` in package.json.
 */
export async function initializeYarnProject({
  pluginPkgDir,
  monorepoRoot,
  exportDir,
  yarnVersion,
  copyYarnLockIfMissing,
}: {
  pluginPkgDir: string;
  monorepoRoot: string;
  exportDir: string;
  yarnVersion: string;
  copyYarnLockIfMissing: boolean;
}): Promise<void> {
  const yarnLockDest = path.join(exportDir, 'yarn.lock');
  const yarnRcDest = path.join(exportDir, YARN_RC_FILENAME);

  await copyYarnLockWhenNeeded(
    copyYarnLockIfMissing,
    yarnLockDest,
    pluginPkgDir,
    monorepoRoot,
  );

  const yarnPathSemver = await yarnPathSemverForExportPackageManager(
    yarnRcDest,
    pluginPkgDir,
    monorepoRoot,
    yarnVersion,
  );

  if (!yarnVersion.startsWith('1.')) {
    await writeBerryStandaloneYarnRc(yarnRcDest);
  }

  await enforceBerryNodeModulesLinker(yarnRcDest, yarnVersion);

  const packageJsonPath = path.join(exportDir, 'package.json');
  const pkgJson = await fs.readJson(packageJsonPath);
  pkgJson.packageManager = `yarn@${yarnSemverForPackageManager(
    yarnPathSemver,
    yarnVersion,
  )}`;
  await fs.writeJson(packageJsonPath, pkgJson, {
    encoding: 'utf8',
    spaces: 2,
  });
}

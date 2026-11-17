import fs from 'fs-extra';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { log, logSection, runCommand } from './support/plugin-export-build';

// 8-minute Jest timeout gives headroom so MAX_ONRAMP_DURATION_MS SLO assertions can report failure before Jest aborts
const TEST_TIMEOUT = 8 * 60 * 1000;
const MAX_ONRAMP_DURATION_MS = 5 * 60 * 1000;
const rhdhCli = path.resolve(__dirname, '../bin/rhdh-cli');

async function readRemoteExport(pluginDir: string) {
  const distDynamicDir = path.join(pluginDir, 'dist-dynamic');
  const distDir = path.join(distDynamicDir, 'dist');
  const remoteEntry = await fs.readFile(
    path.join(distDir, 'remoteEntry.js'),
    'utf8',
  );
  const manifest = await fs.readJson(path.join(distDir, 'mf-manifest.json'));
  return { distDynamicDir, distDir, remoteEntry, manifest };
}

async function assertDefaultRemoteExport(pluginDir: string): Promise<void> {
  const { distDir, remoteEntry, manifest } = await readRemoteExport(pluginDir);
  expect(Buffer.byteLength(remoteEntry)).toBeLessThan(120 * 1024);
  expect(remoteEntry).not.toMatch(
    /\.\.\/(?:\.\.\/)+dynamic-features-shared-modules\//,
  );
  expect(manifest.metaData.remoteEntry.type).not.toBe('module');

  // Host-provided wildcard dependencies must not leave fallback language
  // chunks in the exported plugin.
  const staticFiles = await fs.readdir(path.join(distDir, 'static'));
  expect(
    staticFiles.some(file =>
      file.startsWith('react-syntax-highlighter_languages_highlight_'),
    ),
  ).toBe(false);
}

async function assertSharedEsmRemoteExport(pluginDir: string): Promise<string> {
  const { distDir, remoteEntry, manifest } = await readRemoteExport(pluginDir);

  // The exported plugin carries exactly one runtime module, named after
  // its content.
  const runtimeDir = path.join(distDir, 'shared');
  const runtimeFiles = await fs.readdir(runtimeDir);
  expect(runtimeFiles).toHaveLength(1);
  const sharedRuntimeFileName = runtimeFiles[0];
  expect(sharedRuntimeFileName).toMatch(
    /^webpack-bundler-runtime@.+-[a-f0-9]{16}\.mjs$/,
  );

  const runtimeBytes = await fs.readFile(
    path.join(runtimeDir, sharedRuntimeFileName),
  );
  // Wrap in a plain Uint8Array: Buffer is not assignable to the
  // BinaryLike parameter under newer TypeScript typed-array generics.
  const hash16 = createHash('sha256')
    .update(new Uint8Array(runtimeBytes))
    .digest('hex')
    .slice(0, 16);
  expect(sharedRuntimeFileName.endsWith(`-${hash16}.mjs`)).toBe(true);
  expect(runtimeBytes.length).toBeGreaterThan(0);

  expect(Buffer.byteLength(remoteEntry)).toBeLessThan(10 * 1024);
  expect(manifest.metaData.remoteEntry.type).toBe('module');

  // The externalized MF runtime request in the remote entry is a
  // static relative specifier computed from the deployed plugin name's
  // URL depth under the host's remotes route — resolved against the
  // remoteEntry's own URL it lands on the canonical shared-assets
  // route, so all plugins built with the same toolchain import the
  // same URL (one fetched, evaluated runtime instance), and any proxy
  // prefix carries through. The expected depth is derived from the
  // source package name (deployed as `<name>-dynamic`), covering both
  // package name forms: scoped (`@scope/name-dynamic`) and unscoped
  // (`name-dynamic`).
  const sourcePackageJson = JSON.parse(
    await fs.readFile(path.join(pluginDir, 'package.json'), 'utf-8'),
  );
  const deployedName = `${sourcePackageJson.name}-dynamic`;
  const relativePrefix = '../'.repeat(deployedName.split('/').length + 2);
  expect(remoteEntry).toContain(
    `"${relativePrefix}dynamic-features-shared-modules/${sharedRuntimeFileName}"`,
  );

  return sharedRuntimeFileName;
}

interface BuildAndExportTimings {
  installMs: number;
  typecheckMs: number;
  buildMs: number;
  testMs: number;
  exportMs: number;
}

/** Shared install + typecheck + build + test + export sequence for a generated project. */
async function buildAndExport(
  pluginDir: string,
): Promise<BuildAndExportTimings> {
  log(`Installing generated project in ${pluginDir}`);
  const tInstall = Date.now();
  await runCommand(
    'YARN_ENABLE_IMMUTABLE_INSTALLS=false YARN_ENABLE_SCRIPTS=false yarn install',
    { cwd: pluginDir },
  );
  const installMs = Date.now() - tInstall;

  log('Typechecking generated project');
  const tTypecheck = Date.now();
  await runCommand('yarn tsc', { cwd: pluginDir });
  const typecheckMs = Date.now() - tTypecheck;

  log('Building generated project');
  const tBuild = Date.now();
  await runCommand('yarn build', { cwd: pluginDir });
  const buildMs = Date.now() - tBuild;

  log('Running generated project tests');
  const tTest = Date.now();
  await runCommand('yarn test --watchAll=false', { cwd: pluginDir });
  const testMs = Date.now() - tTest;

  log('Exporting as a dynamic plugin');
  const tExport = Date.now();
  await runCommand(`"${rhdhCli}" plugin export --clean`, { cwd: pluginDir });
  const exportMs = Date.now() - tExport;

  return { installMs, typecheckMs, buildMs, testMs, exportMs };
}

function logTimings(
  label: string,
  scaffoldMs: number,
  timings: BuildAndExportTimings,
): number {
  const totalMs =
    scaffoldMs +
    timings.installMs +
    timings.typecheckMs +
    timings.buildMs +
    timings.testMs +
    timings.exportMs;

  const scaffoldSec = (scaffoldMs / 1000).toFixed(1);
  const installSec = (timings.installMs / 1000).toFixed(1);
  const tscSec = (timings.typecheckMs / 1000).toFixed(1);
  const buildSec = (timings.buildMs / 1000).toFixed(1);
  const testSec = (timings.testMs / 1000).toFixed(1);
  const exportSec = (timings.exportMs / 1000).toFixed(1);
  const totalSec = (totalMs / 1000).toFixed(1);

  log(
    `[timing] ${label}: scaffold=${scaffoldSec}s, install=${installSec}s, tsc=${tscSec}s, build=${buildSec}s, test=${testSec}s, export=${exportSec}s (total=${totalSec}s)`,
  );

  return totalMs;
}

describe('plugin new', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhdh-cli-plugin-new-'));
  const frontendPluginDir = path.join(tmpDir, 'frontend-plugin');

  // Shared across the frontend sub-tests, which run in declaration
  // order: the onramp timing and runtime file name produced by the
  // scoped-plugin tests are asserted again by the unscoped-plugin test.
  let frontendOnrampMs = 0;
  let scopedRuntimeFileName: string | undefined;

  jest.setTimeout(TEST_TIMEOUT);

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it('creates a frontend plugin that installs, typechecks, builds, and exports', async () => {
    logSection('Generate frontend plugin');
    const tScaffold = Date.now();
    await runCommand(
      `"${rhdhCli}" plugin new example-plugin --type frontend --output "${frontendPluginDir}" --rhdh-version 2.1.0`,
    );
    const scaffoldMs = Date.now() - tScaffold;

    const timings = await buildAndExport(frontendPluginDir);
    frontendOnrampMs = logTimings('frontend-plugin', scaffoldMs, timings);

    expect(fs.existsSync(path.join(frontendPluginDir, 'dist'))).toBe(true);
    expect(fs.existsSync(path.join(frontendPluginDir, 'dist-dynamic'))).toBe(
      true,
    );
    expect(
      fs.existsSync(
        path.join(frontendPluginDir, 'dist-dynamic', 'package.json'),
      ),
    ).toBe(true);
    await assertDefaultRemoteExport(frontendPluginDir);
  });

  it('exports a scoped plugin with the shared ESM runtime external', async () => {
    logSection('Export frontend plugin with shared ESM runtime');
    const tSharedEsmExport = Date.now();
    await runCommand(
      `"${rhdhCli}" plugin export --clean --shared-esm-runtime`,
      { cwd: frontendPluginDir },
    );
    const sharedEsmExportMs = Date.now() - tSharedEsmExport;
    log(
      `[timing] frontend shared-esm export: ${(sharedEsmExportMs / 1000).toFixed(1)}s`,
    );

    // Deployed name `@scope/name-dynamic` (two path segments under the
    // host's remotes route): the runtime external escapes four levels
    // above the remoteEntry (asserted by the shared helper, which
    // derives the expected depth from the package name).
    scopedRuntimeFileName =
      await assertSharedEsmRemoteExport(frontendPluginDir);

    // Re-exporting the same build must produce the same content-addressed
    // runtime URL, so identical bytes deduplicate across plugins.
    await runCommand(
      `"${rhdhCli}" plugin export --clean --shared-esm-runtime`,
      { cwd: frontendPluginDir },
    );
    expect(await assertSharedEsmRemoteExport(frontendPluginDir)).toBe(
      scopedRuntimeFileName,
    );

    expect(frontendOnrampMs + sharedEsmExportMs).toBeLessThan(
      MAX_ONRAMP_DURATION_MS,
    );
  });

  it('exports an unscoped plugin with the shared ESM runtime external', async () => {
    // Deployed name `name-dynamic` (one path segment): the runtime
    // external escapes three levels above the remoteEntry. Scaffolding
    // with an explicit unscoped --plugin-package also exercises the
    // scaffolder's package-name override.
    const unscopedPluginDir = path.join(tmpDir, 'frontend-plugin-unscoped');
    await runCommand(
      `"${rhdhCli}" plugin new other-plugin --type frontend --plugin-package plugin-test-unscoped --output "${unscopedPluginDir}" --rhdh-version 2.1.0`,
    );
    await buildAndExport(unscopedPluginDir);
    await runCommand(
      `"${rhdhCli}" plugin export --clean --shared-esm-runtime`,
      { cwd: unscopedPluginDir },
    );
    const unscopedRuntimeFileName =
      await assertSharedEsmRemoteExport(unscopedPluginDir);

    // Cross-plugin (and cross name-form) determinism: the runtime
    // depends only on the rhdh-cli dependency tree, never on plugin
    // code or package name form.
    expect(unscopedRuntimeFileName).toBe(scopedRuntimeFileName);
  });

  it('packages a plugin with --shared-esm-runtime passed through to plugin export', async () => {
    // The scaffolded plugin has no export-dynamic script, so
    // `plugin package` regenerates dist-dynamic through the generated
    // `node <cli> plugin export` command — the flag must arrive there.
    logSection('Package frontend plugin with shared ESM runtime');
    const packagedDir = path.join(tmpDir, 'packaged-frontend-plugin');
    await runCommand(
      `"${rhdhCli}" plugin package --export-to "${packagedDir}" --shared-esm-runtime --force-export`,
      { cwd: frontendPluginDir },
    );
    // If the flag were dropped, the regenerated export would be classic
    // and this would fail on the missing dist/shared directory.
    expect(await assertSharedEsmRemoteExport(frontendPluginDir)).toBe(
      scopedRuntimeFileName,
    );
    expect(fs.existsSync(path.join(packagedDir, 'index.json'))).toBe(true);

    // With an export-dynamic script, `plugin package` goes through
    // `yarn export-dynamic --shared-esm-runtime` instead.
    const pluginPackageJsonPath = path.join(frontendPluginDir, 'package.json');
    const pluginPackageJson = await fs.readJson(pluginPackageJsonPath);
    pluginPackageJson.scripts['export-dynamic'] = `"${rhdhCli}" plugin export`;
    await fs.writeJson(pluginPackageJsonPath, pluginPackageJson);
    await runCommand(
      `"${rhdhCli}" plugin package --export-to "${packagedDir}" --shared-esm-runtime --force-export`,
      { cwd: frontendPluginDir },
    );
    expect(await assertSharedEsmRemoteExport(frontendPluginDir)).toBe(
      scopedRuntimeFileName,
    );
  });

  it('creates a backend plugin that installs, typechecks, builds, and exports', async () => {
    const pluginDir = path.join(tmpDir, 'backend-plugin');

    logSection('Generate backend plugin');
    const tScaffold = Date.now();
    await runCommand(
      `"${rhdhCli}" plugin new example-plugin --type backend --output "${pluginDir}" --rhdh-version 2.1.0`,
    );
    const scaffoldMs = Date.now() - tScaffold;

    const timings = await buildAndExport(pluginDir);
    const totalMs = logTimings('backend-plugin', scaffoldMs, timings);

    expect(fs.existsSync(path.join(pluginDir, 'dist'))).toBe(true);
    expect(fs.existsSync(path.join(pluginDir, 'dist-dynamic'))).toBe(true);
    expect(
      fs.existsSync(path.join(pluginDir, 'dist-dynamic', 'package.json')),
    ).toBe(true);
    expect(totalMs).toBeLessThan(MAX_ONRAMP_DURATION_MS);
  });

  it('creates a catalog-processor-module that installs, typechecks, builds, and exports', async () => {
    const pluginDir = path.join(tmpDir, 'catalog-processor-module');

    logSection('Generate catalog processor module');
    const tScaffold = Date.now();
    await runCommand(
      `"${rhdhCli}" plugin new example-plugin --type catalog-processor-module --output "${pluginDir}" --rhdh-version 2.1.0`,
    );
    const scaffoldMs = Date.now() - tScaffold;

    const timings = await buildAndExport(pluginDir);
    const totalMs = logTimings('catalog-processor-module', scaffoldMs, timings);

    expect(fs.existsSync(path.join(pluginDir, 'dist'))).toBe(true);
    expect(fs.existsSync(path.join(pluginDir, 'dist-dynamic'))).toBe(true);

    // Verify the exported module carries the correct backstage metadata
    const exportedPkg = await fs.readJson(
      path.join(pluginDir, 'dist-dynamic', 'package.json'),
    );
    expect(exportedPkg.backstage.role).toBe('backend-plugin-module');
    expect(exportedPkg.backstage.pluginId).toBe('catalog');
    expect(exportedPkg.backstage.pluginPackage).toBe(
      '@backstage/plugin-catalog-backend',
    );
    expect(totalMs).toBeLessThan(MAX_ONRAMP_DURATION_MS);
  });
});

import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

import { log, logSection, runCommand } from './support/plugin-export-build';

// 8-minute Jest timeout gives headroom so MAX_ONRAMP_DURATION_MS SLO assertions can report failure before Jest aborts
const TEST_TIMEOUT = 8 * 60 * 1000;
const MAX_ONRAMP_DURATION_MS = 5 * 60 * 1000;
const rhdhCli = path.resolve(__dirname, '../bin/rhdh-cli');

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
  await runCommand(`"${rhdhCli}" plugin export`, { cwd: pluginDir });
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

  jest.setTimeout(TEST_TIMEOUT);

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it('creates a frontend plugin that installs, typechecks, builds, and exports', async () => {
    const pluginDir = path.join(tmpDir, 'frontend-plugin');

    logSection('Generate frontend plugin');
    const tScaffold = Date.now();
    await runCommand(
      `"${rhdhCli}" plugin new example-plugin --type frontend --output "${pluginDir}" --rhdh-version 2.1.0`,
    );
    const scaffoldMs = Date.now() - tScaffold;

    const timings = await buildAndExport(pluginDir);
    const totalMs = logTimings('frontend-plugin', scaffoldMs, timings);

    expect(fs.existsSync(path.join(pluginDir, 'dist'))).toBe(true);
    expect(fs.existsSync(path.join(pluginDir, 'dist-dynamic'))).toBe(true);
    expect(
      fs.existsSync(path.join(pluginDir, 'dist-dynamic', 'package.json')),
    ).toBe(true);
    expect(totalMs).toBeLessThan(MAX_ONRAMP_DURATION_MS);
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

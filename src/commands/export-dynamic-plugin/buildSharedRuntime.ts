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

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

import * as esbuild from 'esbuild';
import chalk from 'chalk';
import fs from 'fs-extra';

import { paths } from '../../lib/paths';
import { Task } from '../../lib/tasks';
import { resolveCliModuleBuildConfig } from './moduleFederationResolution';

/**
 * ESM externals for a remote build: the import → URL map applied to
 * rspack's externals, plus the function writing the files backing
 * those URLs into the plugin dist.
 */
export interface EsmExternals {
  /** Resolved import specifier → served URL. */
  externals: Record<string, string>;
  /**
   * Writes the files backing those URLs into `dist/`. Must be called
   * after the MF build — buildBundle empties `dist/`.
   */
  emit: () => Promise<void>;
}

/**
 * Build the single self-contained ESM shared MF runtime module used by
 * `plugin export --shared-esm-runtime`, returning the
 * {@link EsmExternals} it provides: one external mapping rspack's
 * generated webpack-bundler-runtime request to a relative specifier
 * computed at export time from the plugin's deployed name, and the
 * `emit` writing the module into `dist/shared/`.
 *
 * The specifier is static (a plain import in the remoteEntry — required,
 * because rspack's MF remote-entry startup installs the container
 * functions synchronously during evaluation and cannot await a runtime
 * resolved at load time; verified empirically: a top-level-await shim
 * leaves the entry's get/init bound to throwing fallbacks), but
 * RELATIVE: resolved against the remoteEntry's own URL, it carries any
 * proxy prefix and any origin. The `../` count is baked from the
 * deployed name (`<name>-dynamic`, as frontend.ts derives the
 * dist-dynamic package) because the remotes URL layout
 * `<root>/.backstage/dynamic-features/remotes/<name segments>/remoteEntry.js`
 * puts the shared-assets route a fixed two levels plus the name
 * segments above the remoteEntry. Every plugin built with the same
 * toolchain therefore imports the SAME resolved URL — one fetched,
 * evaluated runtime instance across plugins, warmed by the host's
 * preload modulepreload.
 *
 * The route segment name is a cross-repo contract with
 * `DYNAMIC_FEATURES_SHARED_ASSETS_BASE_PATH` in rhdh's
 * `packages/backend/src/modules/dynamicFeaturesPreload/paths.ts`, and
 * the depth with upstream's `/remotes/<plugin name>` URL construction.
 *
 * rspack's generated remote runtime default-imports the
 * webpack-bundler-runtime module, then copies its enumerable exports onto
 * `__webpack_require__.federation`. The runtime built here
 * default-exports the full module namespace, while the bundle contains
 * the runtime wrapper, SDK, error codes, and runtime-core transitively.
 *
 * Built with esbuild for deterministic output: the shim is passed via
 * esbuild's stdin API (no file on disk), and esbuild has no module ID
 * system, so identical inputs always produce identical bytes — unlike
 * rspack's deterministic module IDs, which can incorporate the entry
 * file's absolute path and drift across builds.
 */
export async function buildSharedRuntime(
  pluginName: string,
): Promise<EsmExternals> {
  // Resolutions below go through cli-module-build's bundler config so
  // they match what the build itself resolves, regardless of
  // node_modules hoisting.
  const requireAsConfig = createRequire(resolveCliModuleBuildConfig());
  // The module rspack's generated remote runtime imports.
  const bundlerRuntimeEntry = requireAsConfig.resolve(
    '@module-federation/webpack-bundler-runtime',
  );
  const shimContents = [
    `import * as runtime from ${JSON.stringify(bundlerRuntimeEntry)};`,
    'export default runtime;',
    `export * from ${JSON.stringify(bundlerRuntimeEntry)};`,
    '',
  ].join('\n');

  const result = await esbuild.build({
    stdin: {
      contents: shimContents,
      loader: 'js',
      // Only the `.mjs` extension matters: it selects Node's ESM↔CJS
      // interop (`__toESM(mod, 1)`) for the shim's `import` of the CJS
      // webpack-bundler-runtime, keeping the output bytes identical to a
      // real `.mjs` entry file. The basename never reaches the output.
      sourcefile: 'shared-runtime-entry.mjs',
      // Required: esbuild cannot resolve the shim's import (not even an
      // absolute one) without a directory context for the stdin module.
      // Anchored at the runtime's own directory.
      resolveDir: path.dirname(bundlerRuntimeEntry),
    },
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: true,
    define: { ENV_TARGET: '"web"' },
    write: false,
    logLevel: 'silent',
  });

  if (result.outputFiles.length !== 1) {
    throw new Error(
      `rhdh-cli: expected one shared runtime output, got ${result.outputFiles.length}`,
    );
  }

  const runtimeContents = result.outputFiles[0].contents;
  const hash16 = createHash('sha256')
    .update(runtimeContents)
    .digest('hex')
    .slice(0, 16);
  // The MF family is published in lockstep, so the bundler runtime's
  // version identifies the whole runtime family. Name the module after
  // what it bundles and its content; keyed on the MF version only —
  // rspack builds the plugin's remoteEntry, not the shared runtime.
  const mfVersion = requireAsConfig(
    '@module-federation/webpack-bundler-runtime/package.json',
  ).version;
  const fileName = `webpack-bundler-runtime@${mfVersion}-${hash16}.mjs`;

  Task.log(`Shared MF runtime ${chalk.cyan(fileName)}`);

  // The deployed dynamic-plugin package name (frontend.ts derives
  // dist-dynamic from `<name>-dynamic`) determines the remoteEntry's
  // URL depth under the host's remotes route:
  //   <root>/.backstage/dynamic-features/remotes/<name segments>/remoteEntry.js
  // Escaping the name segments plus the `remotes` and
  // `dynamic-features` levels lands on the .backstage namespace root,
  // next to the shared-assets route.
  const segmentCount = `${pluginName}-dynamic`.split('/').length;
  const relativePrefix = '../'.repeat(segmentCount + 2);

  return {
    // rspack bakes this resolved absolute path into its generated
    // runtime module; mapping it to the relative specifier rewrites
    // that import to the host-served module — resolved against the
    // remoteEntry's own URL, so any proxy prefix and origin carry
    // through, and all plugins built with the same toolchain converge
    // on the same resolved canonical URL (one shared instance).
    externals: {
      [bundlerRuntimeEntry]: `${relativePrefix}dynamic-features-shared-modules/${fileName}`,
    },
    emit: async () => {
      const runtimeDir = path.join(paths.targetDir, 'dist', 'shared');
      await fs.ensureDir(runtimeDir);
      await fs.writeFile(path.join(runtimeDir, fileName), runtimeContents);
    },
  };
}

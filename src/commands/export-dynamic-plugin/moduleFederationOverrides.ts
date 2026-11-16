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

import { createRequire } from 'node:module';

import type { BackstagePackageJson } from '@backstage/cli-node';
import type { ModuleFederationPlugin } from '@module-federation/rspack/plugin';
import type { moduleFederationPlugin } from '@module-federation/sdk';
import type { Compiler } from '@rspack/core';

import { loadAdditionalSharedDependencies } from './additionalSharedDependencies';
import { resolveCliModuleBuildConfig } from './moduleFederationResolution';

/**
 * Module Federation build customization for `rhdh-cli plugin export`
 * frontend remotes — the entire build-side customization of both export
 * modes.
 *
 * Upstream `@backstage/cli-module-build` constructs the remote-build
 * ModuleFederationPlugin with a fixed option set (`filename`, `exposes`,
 * `name`, `runtime: false`, `shared`) and offers no way to pass further
 * plugin options (e.g. `library`, `experiments`), rspack-level compiler
 * options, or externals. This module works around that with one
 * pre-step: a one-shot installer swaps the plugin export that the
 * upstream bundler config reads for a wrapper setting RHDH's override
 * attributes directly. The post-steps — computing the runtime's
 * relative external URL and copying the prebuilt runtime into
 * `dist/shared/` — live in `buildSharedRuntime.ts` and `frontend.ts`.
 *
 * Upstream contribution to propose in backstage/backstage, framed as a
 * distribution-agnostic capability rather than RHDH's runtime
 * management: let remote builds (a) accept rspack-level compiler
 * options and externals, and (b) emit extra files into the plugin
 * dist. Distributions could implement schemes like RHDH's shared MF
 * runtime entirely through it; whatever shape it takes, the
 * attributes set in the wrapper below and the externals produced by
 * `buildSharedRuntime` isolate WHAT rhdh-cli customizes — retarget
 * them to the official mechanism and delete the wrapper and installer.
 */

/**
 * Wrap a ModuleFederationPlugin class so that RHDH's override attributes
 * are applied around the base class — a pure function of its arguments;
 * it touches no global state.
 *
 * When `externals` are provided, the wrapper also emits the remoteEntry
 * as an ES module whose MF runtime is externalized through that map.
 */
export function createModuleFederationPluginWithOverrides(
  Base: typeof ModuleFederationPlugin,
  packageJson: BackstagePackageJson,
  externals?: Record<string, string>,
): typeof ModuleFederationPlugin {
  // Known override attributes, typed with the plugin's own options
  // interface. Every export mode gets a browser-only build target
  // (node-only code tree-shaken from the remote) and the RHDH
  // shared-dependency additions.
  const pluginOptions: moduleFederationPlugin.ModuleFederationPluginOptions = {
    experiments: {
      optimization: {
        target: 'web',
      },
    },
    shared: loadAdditionalSharedDependencies(packageJson),
    // Deployed dynamic plugins are loaded at runtime only — nothing
    // builds against the exported artifact, so the MF dts plugin's
    // generated type archive (@mf-types/, @mf-types.zip,
    // @mf-types.d.ts and the manifest's types field) is dead weight
    // that scales with the plugin's bundled dependencies. Upstream's
    // export handles the absence (it deletes package.json "types").
    dts: false,
    // --shared-esm-runtime: expose the container entry as an ES module
    // (export statements instead of a global variable), so it can be
    // loaded with native import(). The manifest reports
    // remoteEntry.type 'module', which is how the backend preload and
    // the host loader recognize ESM remotes.
    ...(externals && { library: { type: 'module' } }),
  };

  class ModuleFederationPluginWithOverrides extends Base {
    constructor(options: moduleFederationPlugin.ModuleFederationPluginOptions) {
      super({
        ...options,
        ...pluginOptions,
        // One-level merge: upstream's shared dependencies plus the RHDH
        // additions, additions winning per package key.
        shared: {
          ...options.shared,
          ...pluginOptions.shared,
        },
      });
    }

    apply(compiler: Compiler): void {
      if (externals) {
        // Gate for ES-module output; output.module below is the actual
        // format switch and requires this experiment.
        compiler.options.experiments.outputModule = true;
        compiler.options.output.module = true;
        // Load async chunks with native import(). The default 'jsonp'
        // loader injects classic script tags and cannot load ESM
        // chunks.
        compiler.options.output.chunkLoading = 'import';
        new compiler.webpack.ExternalsPlugin('module', externals).apply(
          compiler,
        );
      }
      super.apply(compiler);
    }
  }
  return ModuleFederationPluginWithOverrides;
}

/**
 * Swap the `ModuleFederationPlugin` export that
 * `@backstage/cli-module-build`'s bundler config reads for a wrapper
 * applying RHDH's override attributes. With `externals`, the wrapper
 * also emits ESM remotes externalized through that map.
 *
 * Mutates the resolved module's exports. Called exactly once per export
 * process by `frontend.ts`; there is deliberately no idempotence guard,
 * so repeated installs in one process would stack wrappers.
 */
export function installModuleFederationPluginOverrides(
  packageJson: BackstagePackageJson,
  externals?: Record<string, string>,
): void {
  // Resolve the exact module instance the upstream bundler config
  // reads, through the same chain it reads it: cli-module-build →
  // enhanced/rspack → rspack/plugin. Writable view of the exports —
  // the swap below mutates in place, and TS marks real
  // module-namespace members read-only.
  const requireAsConfig = createRequire(resolveCliModuleBuildConfig());
  const requireAsEnhanced = createRequire(
    requireAsConfig.resolve('@module-federation/enhanced/rspack'),
  );
  const rspackPluginExports = requireAsEnhanced(
    '@module-federation/rspack/plugin',
  ) as { ModuleFederationPlugin: typeof ModuleFederationPlugin };
  rspackPluginExports.ModuleFederationPlugin =
    createModuleFederationPluginWithOverrides(
      rspackPluginExports.ModuleFederationPlugin,
      packageJson,
      externals,
    );
}

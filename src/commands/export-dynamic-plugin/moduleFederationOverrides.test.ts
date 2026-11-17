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

import { BackstagePackageJson } from '@backstage/cli-node';

import { defaultRemoteSharedDependencies } from '@backstage/module-federation-common';

import { createRequire } from 'node:module';

import { createModuleFederationPluginWithOverrides } from './moduleFederationOverrides';
import { resolveCliModuleBuildConfig } from './moduleFederationResolution';

// Hermetic externals map — the wrapper applies whatever it is given.
const esmExternals = {
  '/resolved/node_modules/@module-federation/webpack-bundler-runtime/dist/index.js':
    '../../../../dynamic-features-shared-modules/webpack-bundler-runtime@2.8.0-0123abcd4567ef89.mjs',
};

const testPackageJson = {
  name: 'test-frontend-plugin',
  version: '0.1.0',
  dependencies: {
    zod: '^3.23.0',
    'zod-to-json-schema': '^3.22.0',
    lodash: '^4.17.0',
    parse5: '^7.0.0',
    '@material-ui/core': '^4.12.0',
  },
} as BackstagePackageJson;

/**
 * The real plugin class, resolved through the same chain the installer
 * patches: cli-module-build → enhanced/rspack → rspack/plugin.
 */
function realModuleFederationPlugin() {
  const requireAsConfig = createRequire(resolveCliModuleBuildConfig());
  const requireAsEnhanced = createRequire(
    requireAsConfig.resolve('@module-federation/enhanced/rspack'),
  );
  return requireAsEnhanced('@module-federation/rspack/plugin')
    .ModuleFederationPlugin;
}

/**
 * Constructor-override tests run against the real installed
 * @module-federation/rspack chain that the bundler config reads. The real
 * ModuleFederationPlugin constructor only stores its options, so
 * instantiating the wrapped classes here has no side effects on any build.
 * The global installer is deliberately never exercised by tests.
 */
function upstreamRemoteOptions() {
  return {
    filename: 'remoteEntry.js',
    exposes: { '.': '/repo/src/index.ts' },
    name: 'plugin',
    runtime: false,
    shared: defaultRemoteSharedDependencies(),
  };
}

describe('createModuleFederationPluginWithOverrides (constructor overrides)', () => {
  it('returns a subclass of the real installed plugin', () => {
    const realPlugin = realModuleFederationPlugin();
    const Wrapped = createModuleFederationPluginWithOverrides(
      realPlugin,
      testPackageJson,
    );
    expect(typeof Wrapped).toBe('function');
    expect(Object.getPrototypeOf(Wrapped)).toBe(realPlugin);
  });

  it('classic: sets target web and shared additions over the upstream options', () => {
    const Wrapped = createModuleFederationPluginWithOverrides(
      realModuleFederationPlugin(),
      testPackageJson,
    );

    const instance = new (Wrapped as any)(upstreamRemoteOptions());
    expect(instance._options.filename).toBe('remoteEntry.js');
    expect(instance._options.name).toBe('plugin');
    expect(instance._options.runtime).toBe(false);
    expect(instance._options.experiments).toEqual({
      optimization: { target: 'web' },
    });
    expect(instance._options.library).toBeUndefined();
    // Runtime-only deployment: no MF type archive is generated.
    expect(instance._options.dts).toBe(false);

    // Shared additions merge over the default set, per entry
    expect(instance._options.shared.react).toEqual(
      defaultRemoteSharedDependencies().react,
    );
    expect(instance._options.shared['@backstage/core-components']).toEqual({
      singleton: false,
      eager: false,
      requiredVersion: '*',
      import: false,
    });
    expect(instance._options.shared.zod).toEqual({
      singleton: false,
      eager: false,
      requiredVersion: '^3.23.0',
    });
  });

  it('esm: adds library.type module on top of the classic attributes', () => {
    const Wrapped = createModuleFederationPluginWithOverrides(
      realModuleFederationPlugin(),
      testPackageJson,
      esmExternals,
    );

    const instance = new (Wrapped as any)(upstreamRemoteOptions());
    expect(instance._options.library).toEqual({ type: 'module' });
    expect(instance._options.experiments).toEqual({
      optimization: { target: 'web' },
    });
    expect(instance._options.dts).toBe(false);
    expect(instance._options.shared['@backstage/core-components']).toEqual({
      singleton: false,
      eager: false,
      requiredVersion: '*',
      import: false,
    });
  });
});

describe('createModuleFederationPluginWithOverrides (apply behavior)', () => {
  class FakeBase {
    baseOptions: Record<string, any>;
    baseAppliedWith: unknown;

    constructor(options: Record<string, any>) {
      this.baseOptions = options;
    }

    apply(compiler: any) {
      this.baseAppliedWith = compiler;
    }
  }

  function createStubCompiler() {
    const externalsPlugins: Array<{
      type: string;
      externals: unknown;
      applied: boolean;
    }> = [];
    const compiler = {
      options: {
        experiments: { css: false },
        output: { path: '/dist', filename: 'remoteEntry.js' },
      },
      webpack: {
        ExternalsPlugin: class {
          constructor(type: string, externals: unknown) {
            externalsPlugins.push({ type, externals, applied: false });
          }

          apply() {
            externalsPlugins[externalsPlugins.length - 1].applied = true;
          }
        },
      },
    };
    return { compiler, externalsPlugins };
  }

  it('esm: sets compiler options, applies externals, then defers to the base', () => {
    const { compiler, externalsPlugins } = createStubCompiler();
    const Wrapped = createModuleFederationPluginWithOverrides(
      FakeBase as any,
      testPackageJson,
      esmExternals,
    );

    const instance = new (Wrapped as any)({ name: 'plugin' });
    instance.apply(compiler);

    // Only the known ESM flags are set; pre-existing values are kept
    expect(compiler.options.experiments).toEqual({
      css: false,
      outputModule: true,
    });
    expect(compiler.options.output).toEqual({
      path: '/dist',
      filename: 'remoteEntry.js',
      module: true,
      chunkLoading: 'import',
    });

    // The wrapper applies the given externals map verbatim
    expect(externalsPlugins).toEqual([
      { type: 'module', externals: esmExternals, applied: true },
    ]);
    expect(instance.baseAppliedWith).toBe(compiler);
  });

  it('classic: touches neither compiler options nor externals', () => {
    const { compiler, externalsPlugins } = createStubCompiler();
    const Wrapped = createModuleFederationPluginWithOverrides(
      FakeBase as any,
      testPackageJson,
    );

    const instance = new (Wrapped as any)({ name: 'plugin' });
    instance.apply(compiler);

    expect(compiler.options.experiments).toEqual({ css: false });
    expect(compiler.options.output).toEqual({
      path: '/dist',
      filename: 'remoteEntry.js',
    });
    expect(externalsPlugins).toEqual([]);
    expect(instance.baseAppliedWith).toBe(compiler);
  });
});

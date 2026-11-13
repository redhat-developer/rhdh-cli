/*
 * Copyright (c) Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0.
 */

import {
  applyRemoteModuleFederationExperiments,
  REMOTE_MF_OPTIMIZATION,
  wantsExternalRuntime,
} from './moduleFederationRemote';

describe('wantsExternalRuntime', () => {
  it('defaults to true and is false when include-module-federation-runtime is set', () => {
    expect(wantsExternalRuntime({})).toBe(true);
    expect(
      wantsExternalRuntime({ includeModuleFederationRuntime: false }),
    ).toBe(true);
    expect(wantsExternalRuntime({ includeModuleFederationRuntime: true })).toBe(
      false,
    );
  });
});

describe('applyRemoteModuleFederationExperiments', () => {
  it('merges optimization flags and externalRuntime into plugin options', () => {
    const next = applyRemoteModuleFederationExperiments(
      {
        name: 'demo',
        filename: 'remoteEntry.js',
        runtime: false,
        shared: {},
      },
      true,
    );

    expect(next.experiments).toEqual({
      externalRuntime: true,
      optimization: REMOTE_MF_OPTIMIZATION,
    });
  });

  it('keeps shrink optimizations when externalRuntime is disabled', () => {
    const next = applyRemoteModuleFederationExperiments(
      {
        name: 'demo',
        filename: 'remoteEntry.js',
        runtime: false,
        shared: {},
        experiments: { asyncStartup: true },
      },
      false,
    );

    expect(next.experiments).toEqual({
      asyncStartup: true,
      externalRuntime: false,
      optimization: REMOTE_MF_OPTIMIZATION,
    });
  });
});

describe('withRemoteModuleFederationExperiments', () => {
  it('rebuilds ModuleFederationPlugin instances from createConfig with experiments', async () => {
    const bundlerConfig = require('@backstage/cli-module-build/dist/lib/bundler/config.cjs.js');
    const {
      withRemoteModuleFederationExperiments,
    } = require('./moduleFederationRemote');

    class ModuleFederationPlugin {
      _options: Record<string, unknown>;
      constructor(options: Record<string, unknown>) {
        this._options = options;
      }
    }

    const original = bundlerConfig.createConfig;
    const fakePlugin = new ModuleFederationPlugin({
      name: 'demo',
      filename: 'remoteEntry.js',
      runtime: false,
      shared: {},
    });

    bundlerConfig.createConfig = jest.fn(async () => ({
      plugins: [fakePlugin, { constructor: { name: 'OtherPlugin' } }],
    }));

    try {
      await withRemoteModuleFederationExperiments(true, async () => {
        const cfg = await bundlerConfig.createConfig();
        const mf = cfg.plugins[0];
        expect(mf.constructor.name).toBe('ModuleFederationPlugin');
        expect(mf).not.toBe(fakePlugin);
        expect(mf._options.experiments).toEqual({
          externalRuntime: true,
          optimization: REMOTE_MF_OPTIMIZATION,
        });
        expect(cfg.plugins[1].constructor.name).toBe('OtherPlugin');
      });
    } finally {
      bundlerConfig.createConfig = original;
    }
  });

  it('restores the original createConfig after the callback', async () => {
    const bundlerConfig = require('@backstage/cli-module-build/dist/lib/bundler/config.cjs.js');
    const {
      withRemoteModuleFederationExperiments,
    } = require('./moduleFederationRemote');
    const original = bundlerConfig.createConfig;

    await withRemoteModuleFederationExperiments(true, async () => {
      expect(bundlerConfig.createConfig).not.toBe(original);
    });

    expect(bundlerConfig.createConfig).toBe(original);
  });
});

/*
 * Copyright (c) Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0.
 */

import {
  applyRemoteModuleFederationExperiments,
  REMOTE_MF_OPTIMIZATION,
} from './moduleFederationRemote';

describe('applyRemoteModuleFederationExperiments', () => {
  it('merges shrink-in-place optimization flags into plugin options', () => {
    const next = applyRemoteModuleFederationExperiments({
      name: 'demo',
      filename: 'remoteEntry.js',
      runtime: false,
      shared: {},
    });

    expect(next.experiments).toEqual({
      optimization: REMOTE_MF_OPTIMIZATION,
    });
  });

  it('preserves existing experiment fields while merging optimization', () => {
    const next = applyRemoteModuleFederationExperiments({
      name: 'demo',
      filename: 'remoteEntry.js',
      runtime: false,
      shared: {},
      experiments: { asyncStartup: true },
    });

    expect(next.experiments).toEqual({
      asyncStartup: true,
      optimization: REMOTE_MF_OPTIMIZATION,
    });
  });
});

describe('withRemoteModuleFederationExperiments', () => {
  it('rebuilds ModuleFederationPlugin instances from createConfig with optimizations', async () => {
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
      await withRemoteModuleFederationExperiments(async () => {
        const cfg = await bundlerConfig.createConfig();
        const mf = cfg.plugins[0];
        expect(mf.constructor.name).toBe('ModuleFederationPlugin');
        expect(mf).not.toBe(fakePlugin);
        expect(mf._options.experiments).toEqual({
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

    await withRemoteModuleFederationExperiments(async () => {
      expect(bundlerConfig.createConfig).not.toBe(original);
    });

    expect(bundlerConfig.createConfig).toBe(original);
  });
});

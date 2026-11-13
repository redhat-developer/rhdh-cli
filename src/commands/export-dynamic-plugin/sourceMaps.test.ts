/*
 * Copyright (c) Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0.
 */

import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { removeSourceMapFiles, withBundlerSourceMaps } from './sourceMaps';

describe('removeSourceMapFiles', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'source-maps-'));
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  it('removes .map files recursively and leaves other files intact', async () => {
    await fs.ensureDir(path.join(tempDir, 'dist/static'));
    await fs.writeFile(path.join(tempDir, 'dist/remoteEntry.js'), 'js');
    await fs.writeFile(path.join(tempDir, 'dist/remoteEntry.js.map'), 'map');
    await fs.writeFile(path.join(tempDir, 'dist/static/chunk.js'), 'chunk');
    await fs.writeFile(
      path.join(tempDir, 'dist/static/chunk.js.map'),
      'chunk-map',
    );

    const removed = await removeSourceMapFiles(tempDir);

    expect(removed).toBe(2);
    expect(await fs.pathExists(path.join(tempDir, 'dist/remoteEntry.js'))).toBe(
      true,
    );
    expect(
      await fs.pathExists(path.join(tempDir, 'dist/remoteEntry.js.map')),
    ).toBe(false);
    expect(
      await fs.pathExists(path.join(tempDir, 'dist/static/chunk.js')),
    ).toBe(true);
    expect(
      await fs.pathExists(path.join(tempDir, 'dist/static/chunk.js.map')),
    ).toBe(false);
  });

  it('returns 0 when no source maps are present', async () => {
    await fs.writeFile(path.join(tempDir, 'index.js'), 'js');
    await expect(removeSourceMapFiles(tempDir)).resolves.toBe(0);
  });
});

describe('withBundlerSourceMaps', () => {
  it('forces bundler createConfig to set devtool false when disabled', async () => {
    const config = require('@backstage/cli-module-build/dist/lib/bundler/config.cjs.js');
    const original = config.createConfig;
    config.createConfig = jest.fn(async () => ({
      mode: 'production',
      devtool: 'source-map',
    }));

    try {
      await withBundlerSourceMaps(false, async () => {
        const cfg = await config.createConfig();
        expect(cfg).toEqual({ mode: 'production', devtool: false });
      });
    } finally {
      config.createConfig = original;
    }
  });

  it('restores the original createConfig after the callback', async () => {
    const config = require('@backstage/cli-module-build/dist/lib/bundler/config.cjs.js');
    const original = config.createConfig;

    await withBundlerSourceMaps(false, async () => {
      expect(config.createConfig).not.toBe(original);
    });

    expect(config.createConfig).toBe(original);
  });

  it('leaves createConfig untouched when source maps are enabled', async () => {
    const config = require('@backstage/cli-module-build/dist/lib/bundler/config.cjs.js');
    const original = config.createConfig;

    await withBundlerSourceMaps(true, async () => {
      expect(config.createConfig).toBe(original);
    });

    expect(config.createConfig).toBe(original);
  });
});

describe('wantsSourceMaps', () => {
  const { wantsSourceMaps } = require('./sourceMaps');

  it('is false by default and true when the flag is set', () => {
    expect(wantsSourceMaps({})).toBe(false);
    expect(wantsSourceMaps({ sourceMaps: false })).toBe(false);
    expect(wantsSourceMaps({ sourceMaps: true })).toBe(true);
  });
});

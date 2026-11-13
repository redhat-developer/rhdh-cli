/*
 * Copyright (c) Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0.
 */

import fs from 'fs-extra';
import path from 'path';
import recursive from 'recursive-readdir';

/**
 * Recursively delete `*.map` files under `dir`.
 * Returns the number of files removed.
 */
export async function removeSourceMapFiles(dir: string): Promise<number> {
  if (!(await fs.pathExists(dir))) {
    return 0;
  }

  const mapFiles = await recursive(dir, [
    (file, stats) => !(stats.isDirectory() || file.endsWith('.map')),
  ]);

  await Promise.all(mapFiles.map(file => fs.remove(file)));
  return mapFiles.length;
}

type CreateConfig = (...args: unknown[]) => Promise<Record<string, unknown>>;

/**
 * Run `fn` with the Backstage frontend bundler's `createConfig` patched so
 * production builds omit source maps when `enabled` is false.
 *
 * Upstream hardcodes `devtool: "source-map"` for production; patching the
 * cached module is the least-invasive way to turn that off for dynamic export.
 */
export async function withBundlerSourceMaps(
  enabled: boolean,
  fn: () => Promise<void>,
): Promise<void> {
  if (enabled) {
    await fn();
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const config =
    require('@backstage/cli-module-build/dist/lib/bundler/config.cjs.js') as {
      createConfig: CreateConfig;
    };
  const original = config.createConfig;

  config.createConfig = async (...args: unknown[]) => {
    const cfg = await original(...args);
    return { ...cfg, devtool: false };
  };

  try {
    await fn();
  } finally {
    config.createConfig = original;
  }
}

/** Whether CLI options request source maps (opt-in; default off). */
export function wantsSourceMaps(opts: { sourceMaps?: boolean }): boolean {
  return Boolean(opts.sourceMaps);
}

/**
 * Drop any leftover source maps from a directory after export/pack.
 * Used for backend bundles (esbuild) and as a safety net for frontend.
 */
export async function stripSourceMapsIfDisabled(
  enabled: boolean,
  dir: string,
  log: (message: string) => void,
): Promise<void> {
  if (enabled) {
    return;
  }
  const removed = await removeSourceMapFiles(dir);
  if (removed > 0) {
    log(
      `Removed ${removed} source map file${removed === 1 ? '' : 's'} from ${path.relative(process.cwd(), dir) || dir}`,
    );
  }
}

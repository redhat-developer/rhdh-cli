/*
 * Copyright (c) Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0.
 */

/**
 * Module Federation remote-build size optimizations for dynamic frontend plugins.
 *
 * These `experiments.optimization` flags keep the embedded MF runtime smaller
 * without requiring a host-provided runtime global. Safe for remotes that only
 * expose modules and never consume other remotes.
 */

export const REMOTE_MF_OPTIMIZATION = {
  disableSnapshot: true,
  target: 'web' as const,
  /** Remotes only expose; they do not load other remotes. */
  disableRemote: true,
};

type MfPluginOptions = {
  experiments?: {
    optimization?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export function applyRemoteModuleFederationExperiments(
  options: MfPluginOptions,
): MfPluginOptions {
  return {
    ...options,
    experiments: {
      ...(options.experiments || {}),
      optimization: {
        ...(options.experiments?.optimization || {}),
        ...REMOTE_MF_OPTIMIZATION,
      },
    },
  };
}

type CreateConfig = (...args: unknown[]) => Promise<{
  plugins?: Array<{
    constructor?: { name?: string };
    _options?: MfPluginOptions;
  }>;
}>;

/**
 * Patch Backstage `createConfig` so ModuleFederationPlugin instances for
 * remotes get size-oriented experiments, then restore the original.
 */
export async function withRemoteModuleFederationExperiments(
  fn: () => Promise<void>,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const bundlerConfig =
    require('@backstage/cli-module-build/dist/lib/bundler/config.cjs.js') as {
      createConfig: CreateConfig;
    };

  const original = bundlerConfig.createConfig;

  bundlerConfig.createConfig = async (...args: unknown[]) => {
    const cfg = await original(...args);
    if (!cfg.plugins) {
      return cfg;
    }
    cfg.plugins = cfg.plugins.map(plugin => {
      if (
        plugin?.constructor?.name !== 'ModuleFederationPlugin' ||
        !plugin._options
      ) {
        return plugin;
      }
      // Reuse the bundler's own constructor (avoids a direct enhanced import).
      const PluginCtor = plugin.constructor as new (
        options: MfPluginOptions,
      ) => typeof plugin;
      return new PluginCtor(
        applyRemoteModuleFederationExperiments(plugin._options),
      );
    });
    return cfg;
  };

  try {
    await fn();
  } finally {
    bundlerConfig.createConfig = original;
  }
}

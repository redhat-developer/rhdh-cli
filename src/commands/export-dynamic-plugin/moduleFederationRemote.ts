/*
 * Copyright (c) Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0.
 */

/**
 * Module Federation remote-build experiments for dynamic frontend plugins.
 *
 * `externalRuntime` externalizes `@module-federation/runtime-core` so each
 * remoteEntry does not embed a full copy. The host must provide
 * `globalThis._FEDERATION_RUNTIME_CORE` (e.g. via `experiments.provideExternalRuntime`
 * on a pure consumer). Pass `--include-module-federation-runtime` to embed the runtime again.
 *
 * Shrink flags (`disableSnapshot`, `target: 'web'`, `disableRemote`) are always
 * applied for remotes that only expose modules and never consume other remotes.
 */

export const REMOTE_MF_OPTIMIZATION = {
  disableSnapshot: true,
  target: 'web' as const,
  /** Remotes only expose; they do not load other remotes. */
  disableRemote: true,
};

type MfPluginOptions = {
  experiments?: {
    externalRuntime?: boolean;
    optimization?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

/**
 * Whether to externalize MF runtime-core (default).
 * Cleared when `--include-module-federation-runtime` is set.
 */
export function wantsExternalRuntime(opts: {
  includeModuleFederationRuntime?: boolean;
}): boolean {
  return !opts.includeModuleFederationRuntime;
}

export function applyRemoteModuleFederationExperiments(
  options: MfPluginOptions,
  externalRuntime: boolean,
): MfPluginOptions {
  return {
    ...options,
    experiments: {
      ...(options.experiments || {}),
      externalRuntime,
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
  externalRuntime: boolean,
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
        applyRemoteModuleFederationExperiments(
          plugin._options,
          externalRuntime,
        ),
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

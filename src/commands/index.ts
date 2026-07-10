/*
 * Copyright 2020 The Backstage Authors
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

import { assertError } from '@backstage/errors';

import { Command } from 'commander';

import { exitWithError } from '../lib/errors';

export function registerPluginCommand(program: Command) {
  const command = program
    .command('plugin [command]')
    .description('Lifecycle scripts for individual plugins');

  command
    .command('export')
    .description(
      'Build and export a plugin package to be loaded as a dynamic plugin. The repackaged dynamic plugin is exported inside a ./dist-dynamic sub-folder.',
    )
    .option(
      '--no-install',
      'Do not run `yarn install` to fill the dynamic plugin `node_modules` folder (backend plugin only).',
    )
    .option(
      '--no-build',
      'Do not run `yarn build` on the main and embedded packages before exporting (backend plugin only).',
    )
    .option(
      '--clean',
      'Remove the dynamic plugin output before exporting again.',
    )
    .option(
      '--verbose',
      'Stream detailed output from internal build, pack, and install steps to the console (backend plugin only).',
    )
    .option(
      '--output-destination <dir>',
      'Directory in which the bundle subdirectory is created. Defaults to the current package directory (backend plugin only).',
    )
    .option(
      '--pre-packed-dir <path>',
      'Path to a pre-built dist workspace (from backstage-cli build-workspace --alwaysPack). Skips local dependency packing and uses pre-packed packages directly (backend plugin only).',
    )
    .option(
      '--strict-deps',
      'Fail export when production dependencies include disallowed heavy backend packages. Use in CI to enforce dependency rules (backend plugin only).',
      false,
    )
    .option(
      '--dev',
      'Allow testing/debugging a dynamic plugin locally. This creates a link from the dynamic plugin content to the plugin package `src` folder, to enable the use of source maps (backend plugin only). This also installs the dynamic plugin content (symlink) into the dynamic plugins root folder configured in the app config (or copies the plugin content to the location explicitely provided by the `--dynamic-plugins-root` argument).',
    )
    .option(
      '--dynamic-plugins-root <dynamic-plugins-root>',
      'Provides the dynamic plugins root folder when the dynamic plugins content should be copied when using the `--dev` argument.',
    )
    .option(
      '--scalprum-config <file>',
      'Allows retrieving scalprum configuration from an external JSON file, instead of using a `scalprum` field of the `package.json`. Frontend plugins only.',
    )
    .option('--minify', '[Deprecated] No longer supported. Ignored.')
    .option(
      '--embed-package [package-name...]',
      '[Deprecated] No longer supported. The upstream bundle command embeds all dependencies automatically. Ignored.',
    )
    .option(
      '--shared-package [package-name...]',
      '[Deprecated] No longer supported. The upstream bundle command produces fully self-contained bundles. Ignored.',
    )
    .option(
      '--allow-native-package [package-name...]',
      '[Deprecated] No longer supported. Ignored.',
    )
    .option(
      '--suppress-native-package [package-name...]',
      '[Deprecated] No longer supported. Ignored.',
    )
    .option(
      '--ignore-version-check [packageName...]',
      '[Deprecated] No longer supported. Ignored.',
    )
    .option(
      '--track-dynamic-manifest-and-lock-file',
      '[Deprecated] No longer supported. Ignored.',
      false,
    )
    .option(
      '--generate-scalprum-assets',
      'Generate the dynamic frontend plugin assets through Scalprum in the `dist-scalprum` folder.',
      true,
    )
    .option('--no-generate-scalprum-assets', '', false)
    .option(
      '--generate-module-federation-assets',
      'Generate the dynamic frontend plugin assets through standard module federation in the `dist` folder.',
      true,
    )
    .option('--no-generate-module-federation-assets', '', false)
    .action(lazy(() => import('./export-dynamic-plugin').then(m => m.command)));

  command
    .command('package')
    .description(
      'Package up exported dynamic plugins as container image for deployment',
    )
    .option(
      '--force-export',
      'Regenerate the dist-dynamic folder for each plugin even if it already exists',
    )
    .option(
      '--preserve-temp-dir',
      'Leave the temporary staging directory on the filesystem instead of deleting it',
    )
    .option(
      '--export-to <directory>',
      'Export the plugins to the specified directory, skips building the container image',
    )
    .option(
      '-t, --tag <tag>',
      'Tag name to use when building the plugin registry image.  Required if "--export-to" is not specified',
    )
    .option(
      '--use-docker',
      'Use Docker as the container tool (deprecated, use --container-tool instead)',
    )
    .option(
      '--container-tool <tool>',
      'Container tool to use for building the image. Allowed values: "docker", "podman", "buildah". Default is "podman".',
      'podman',
    )
    .option(
      '--platform <platform>',
      'Platform to use when building the container image. Default is "linux/amd64". Can be set to "" to not set --platform flag in builder command.',
      'linux/amd64',
    )
    .option(
      '--annotation <key=value...>',
      'Add annotation to the container image. Can be specified multiple times.',
    )
    .option(
      '--label <key=value...>',
      'Add label to the container image. Can be specified multiple times.',
    )
    .action(
      lazy(() => import('./package-dynamic-plugins').then(m => m.command)),
    );
}
export function registerCommands(program: Command) {
  registerPluginCommand(program);
}

// Wraps an action function so that it always exits and handles errors
function lazy(
  getActionFunc: () => Promise<(...args: any[]) => Promise<void>>,
): (...args: any[]) => Promise<never> {
  return async (...args: any[]) => {
    try {
      const actionFunc = await getActionFunc();
      await actionFunc(...args);

      process.exit(0);
    } catch (error) {
      assertError(error);
      exitWithError(error);
    }
  };
}

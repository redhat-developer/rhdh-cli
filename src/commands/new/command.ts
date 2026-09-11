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

import { OptionValues } from 'commander';
import fs from 'fs-extra';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

import { paths } from '../../lib/paths';
import { resolveRhdhVersion } from '../../lib/rhdhVersion';
import { Task, templatingTask } from '../../lib/tasks';

export const pluginTypes = ['frontend', 'backend', 'backend-module'] as const;
export type PluginType = (typeof pluginTypes)[number];

export interface CreatePluginOptions {
  name?: string;
  type?: string;
  output?: string;
  rhdhVersion?: string;
  manifestFile?: string;
}

export interface PluginProjectResult {
  outputDir: string;
  rhdhVersion: string;
  backstageVersion: string;
}

type Prompt = (question: string) => Promise<string>;

function assertPluginName(name: string): void {
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
    throw new Error(
      'Plugin name must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens.',
    );
  }
}

function assertPluginType(
  type: string | undefined,
): asserts type is PluginType {
  if (!type || !pluginTypes.includes(type as PluginType)) {
    throw new Error(`Plugin type must be one of: ${pluginTypes.join(', ')}.`);
  }
}

export async function completeInteractiveOptions(
  options: CreatePluginOptions,
  prompt: Prompt,
): Promise<CreatePluginOptions> {
  const name = options.name || (await prompt('Plugin name: ')).trim();
  const type =
    options.type ||
    (await prompt('Plugin type (frontend, backend, backend-module): ')).trim();
  if (!name || !type) {
    throw new Error('Plugin name and type cannot be empty.');
  }
  return { ...options, name, type };
}

async function promptForMissingOptions(
  options: CreatePluginOptions,
): Promise<CreatePluginOptions> {
  if (options.name && options.type) {
    return options;
  }
  if (!process.stdin.isTTY) {
    const missing = [
      !options.name && 'plugin name',
      !options.type && '--type',
    ].filter(Boolean);
    throw new Error(
      `${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} required when running without an interactive terminal.`,
    );
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await completeInteractiveOptions(options, question =>
      readline.question(question),
    );
  } finally {
    readline.close();
  }
}

/** Creates a standalone plugin project from a version-pinned template. */
export async function createPluginProject(
  options: CreatePluginOptions,
): Promise<PluginProjectResult> {
  if (!options.name) {
    throw new Error(
      'Plugin name is required. Pass it as an argument or with --name.',
    );
  }
  assertPluginName(options.name);
  assertPluginType(options.type);

  const outputDir = path.resolve(options.output || options.name);
  const outputExisted = await fs.pathExists(outputDir);
  if (outputExisted) {
    const contents = await fs.readdir(outputDir);
    if (contents.length > 0) {
      throw new Error(`Output directory "${outputDir}" is not empty.`);
    }
  }

  const resolved = await resolveRhdhVersion(options.rhdhVersion, {
    manifestFile: options.manifestFile,
  });
  const versionProvider = (packageName: string): string => {
    const version = resolved.packages.get(packageName);
    if (!version) {
      throw new Error(
        `The Backstage ${resolved.backstageVersion} release manifest does not contain ${packageName}.`,
      );
    }
    return version;
  };
  const templateDir = paths.resolveOwn(`templates/plugin-new/${options.type}`);

  await fs.ensureDir(outputDir);
  try {
    await templatingTask(
      templateDir,
      outputDir,
      {
        pluginId: options.name,
        packageName: `@internal/backstage-plugin-${options.name}`,
        rhdhVersion: resolved.rhdhVersion,
        backstageVersion: resolved.backstageVersion,
      },
      versionProvider,
      false,
    );
  } catch (error) {
    if (!outputExisted) {
      await fs.remove(outputDir);
    }
    throw error;
  }

  return {
    outputDir,
    rhdhVersion: resolved.rhdhVersion,
    backstageVersion: resolved.backstageVersion,
  };
}

/** CLI command entry point for `rhdh-cli plugin new`. */
export async function command(
  name: string | undefined,
  opts: OptionValues,
): Promise<void> {
  if (name && opts.name && name !== opts.name) {
    throw new Error(
      'Plugin name argument and --name must match when both are provided.',
    );
  }

  const options = await promptForMissingOptions({
    name: name || opts.name,
    type: opts.type,
    output: opts.output,
    rhdhVersion: opts.rhdhVersion,
    manifestFile: opts.manifestFile,
  });
  const result = await createPluginProject(options);

  Task.log(
    `Created plugin in ${result.outputDir} for RHDH ${result.rhdhVersion} (Backstage ${result.backstageVersion}).\n`,
  );
}

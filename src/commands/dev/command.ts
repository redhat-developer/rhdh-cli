/*
 * Copyright 2024 The Backstage Authors
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
import YAML from 'yaml';
import path from 'node:path';

import { execFile, run } from '../../lib/run';
import { Task } from '../../lib/tasks';
import { paths } from '../../lib/paths';
import { command as exportCommand } from '../export-dynamic-plugin';

const requiredRuntimeFiles = [
  'compose.yaml',
  'compose-dynamic-plugins-root.yaml',
  'prepare-and-install-dynamic-plugins.sh',
  'wait-for-plugins-and-start.sh',
];
const generatedConfig = 'configs/dynamic-plugins/rhdh-cli.generated.yaml';

export function resolveRuntimeDir(runtimeDir: string | undefined): string {
  const resolved = runtimeDir ?? process.env.RHDH_LOCAL_DIR;
  if (!resolved) {
    throw new Error(
      'Specify --rhdh-local-dir <directory> or set RHDH_LOCAL_DIR to an existing RHDH Local checkout.',
    );
  }
  return resolved;
}

export async function validateRuntime(runtimeDir: string): Promise<string> {
  const resolved = path.resolve(runtimeDir);
  const missing = (
    await Promise.all(
      requiredRuntimeFiles.map(async file =>
        (await fs.pathExists(path.join(resolved, file))) ? undefined : file,
      ),
    )
  ).filter((file): file is string => Boolean(file));

  if (missing.length > 0) {
    throw new Error(
      `Invalid RHDH Local directory ${resolved}. Missing required files: ${missing.join(', ')}`,
    );
  }
  return resolved;
}

export function validateContainerTool(containerTool: string): string {
  if (containerTool !== 'podman' && containerTool !== 'docker') {
    throw new Error(
      `Invalid value for --container-tool: ${containerTool}. Allowed values are: podman, docker`,
    );
  }
  return containerTool;
}

async function resolveAndValidate(opts: OptionValues) {
  const runtimeDir = await validateRuntime(
    resolveRuntimeDir(opts.rhdhLocalDir),
  );
  const containerTool = validateContainerTool(opts.containerTool);
  return { runtimeDir, containerTool };
}

async function getRuntimeStatus(
  containerTool: string,
  runtimeDir: string,
): Promise<string> {
  const { stdout } = await execFile(
    containerTool,
    composeStatusArgs(containerTool),
    {
      cwd: runtimeDir,
      shell: false,
    },
  );
  return formatRuntimeStatus(parseComposeStatus(stdout));
}

async function compose(
  containerTool: string,
  runtimeDir: string,
  args: string[],
) {
  await run(containerTool, args, { cwd: runtimeDir, shell: false });
}

export async function start(opts: OptionValues) {
  const { runtimeDir, containerTool } = await resolveAndValidate(opts);
  await validateProjectFiles();
  await ensureGeneratedConfigIncluded(runtimeDir, opts.configure);
  await exportCommand({ build: true, install: true });
  await stagePlugin(runtimeDir);
  await compose(containerTool, runtimeDir, composeArgs('start'));
}

export async function update(opts: OptionValues) {
  const { runtimeDir, containerTool } = await resolveAndValidate(opts);
  await validateProjectFiles();
  await exportCommand({ build: true, install: true });
  await stagePlugin(runtimeDir);
  for (const action of ['install-dynamic-plugins', 'stop-rhdh', 'start-rhdh']) {
    await compose(containerTool, runtimeDir, composeArgs(action));
  }
  Task.log(await getRuntimeStatus(containerTool, runtimeDir));
}

export async function stop(opts: OptionValues) {
  const { runtimeDir, containerTool } = await resolveAndValidate(opts);
  await compose(containerTool, runtimeDir, composeArgs('stop'));
  if (opts.clean) {
    await compose(containerTool, runtimeDir, composeArgs('clean'));
    Task.log(
      'Stopped the RHDH Local runtime without removing volumes, configuration, or dynamic plugin artifacts.',
    );
  }
}

export async function restart(opts: OptionValues) {
  const { runtimeDir, containerTool } = await resolveAndValidate(opts);
  await compose(containerTool, runtimeDir, composeArgs('stop-rhdh'));
  await compose(containerTool, runtimeDir, composeArgs('start-rhdh'));
  Task.log(await getRuntimeStatus(containerTool, runtimeDir));
}

export async function logs(opts: OptionValues) {
  const { runtimeDir, containerTool } = await resolveAndValidate(opts);
  await compose(
    containerTool,
    runtimeDir,
    composeArgs('logs', {
      includeAll: opts.all,
      showRhdh: opts.rhdh,
      showInstaller: opts.installer,
      follow: opts.follow,
    }),
  );
}

export async function status(opts: OptionValues) {
  const { runtimeDir, containerTool } = await resolveAndValidate(opts);
  Task.log(await getRuntimeStatus(containerTool, runtimeDir));
}

export async function validateProjectFiles(): Promise<void> {
  const packageJson = await fs.readJson(paths.resolveTarget('package.json'));
  const role: string | undefined = packageJson?.backstage?.role;
  const isBackend =
    role === 'backend-plugin' || role === 'backend-plugin-module';
  if (isBackend) {
    const distTypes = resolveDistTypes();
    if (!(await fs.pathExists(distTypes))) {
      throw new Error(
        `${distTypes} not found. Run \`yarn tsc\` before using \`plugin dev\`.`,
      );
    }
  }
}

/**
 * Resolve the dist-types directory for the current plugin.
 *
 * In a standalone project targetDir === targetRoot, so dist-types sits directly
 * inside the plugin directory. In a Backstage monorepo workspace the workspace
 * tsconfig.json uses `rootDir: "."` and `outDir: "dist-types"` at the workspace
 * root, so the compiled types land at:
 *   <workspaceRoot>/dist-types/<relativePathToPlugin>/
 */
export function resolveDistTypes(): string {
  const targetDir = paths.targetDir;
  const targetRoot = paths.targetRoot;
  if (targetDir === targetRoot) {
    return path.join(targetDir, 'dist-types');
  }
  const relativePlugin = path.relative(targetRoot, targetDir);
  return path.join(targetRoot, 'dist-types', relativePlugin);
}

export async function stagePlugin(runtimeDir: string): Promise<void> {
  const packageJson = await fs.readJson(paths.resolveTarget('package.json'));
  const pluginName = packageJson.name.replace(/^@/, '').replaceAll('/', '-');
  const localPluginsDir = path.join(runtimeDir, 'local-plugins');
  const destination = path.join(localPluginsDir, pluginName);

  // Guard against crafted package names (e.g. ".." or "@") resolving to a
  // path at or outside local-plugins/, which would cause fs.remove to delete
  // the local-plugins/ directory or the runtimeDir itself.
  const relative = path.relative(localPluginsDir, destination);
  if (
    !relative ||
    relative === '.' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `Derived plugin directory ${destination} is not inside ${localPluginsDir}. Check the package name in package.json.`,
    );
  }

  const source = paths.resolveTarget('dist-dynamic');
  if (!(await fs.pathExists(source))) {
    throw new Error(`Plugin export did not create ${source}.`);
  }
  // Remove any existing staged copy before copying — fs.copy with overwrite
  // mishandles relative symlinks (e.g. .bin/ entries) when the destination
  // already exists and contains matching symlinks.
  await fs.remove(destination);
  await fs.copy(source, destination, { dereference: false });
  await updateGeneratedConfig(runtimeDir, `./local-plugins/${pluginName}`);
  Task.log(`Staged dynamic plugin at ${destination}.`);
}

export async function updateGeneratedConfig(
  runtimeDir: string,
  pluginPackage: string,
): Promise<void> {
  const file = path.join(runtimeDir, generatedConfig);
  await fs.ensureDir(path.dirname(file));
  if (await fs.pathExists(file)) {
    try {
      const existing = YAML.parse(await fs.readFile(file, 'utf8'));
      const existingPackage = existing?.plugins?.[0]?.package;
      if (existingPackage && existingPackage !== pluginPackage) {
        Task.log(
          `Warning: replacing existing plugin entry (${existingPackage}) with ${pluginPackage}. Only one plugin can be active in ${generatedConfig} at a time.`,
        );
      }
    } catch {
      // If the file is unreadable or unparseable, overwrite silently.
    }
  }
  await fs.writeFile(
    file,
    YAML.stringify({
      plugins: [
        {
          package: pluginPackage,
          disabled: false,
          pullPolicy: 'Always',
        },
      ],
    }),
  );
}

export async function ensureGeneratedConfigIncluded(
  runtimeDir: string,
  configure: boolean,
): Promise<void> {
  const override = path.join(
    runtimeDir,
    'configs/dynamic-plugins/dynamic-plugins.override.yaml',
  );
  if (!(await fs.pathExists(override))) {
    throw new Error(
      `RHDH Local override configuration is missing: ${override}. Create it before using plugin dev.`,
    );
  }
  const document = YAML.parseDocument(await fs.readFile(override, 'utf8'));
  if (document.errors.length > 0) {
    throw new Error(`Invalid RHDH Local YAML: ${document.errors[0].message}`);
  }
  const includes = document.get('includes', true);
  const alreadyIncluded =
    YAML.isSeq(includes) &&
    includes.items.some(
      item => YAML.isScalar(item) && item.value === generatedConfig,
    );
  if (alreadyIncluded) return;
  if (!configure) {
    throw new Error(
      `Add ${generatedConfig} to ${override}'s includes list, or rerun with --configure.`,
    );
  }
  if (includes !== undefined && !YAML.isSeq(includes)) {
    throw new Error(`The includes field in ${override} must be a YAML list.`);
  }
  if (YAML.isSeq(includes)) includes.add(generatedConfig);
  else document.set('includes', [generatedConfig]);
  await fs.writeFile(override, document.toString());
  Task.log(`Added ${generatedConfig} to ${override}.`);
}

type LogsOptions = {
  includeAll?: boolean;
  showRhdh?: boolean;
  showInstaller?: boolean;
  follow?: boolean;
};

export function composeStatusArgs(containerTool: string): string[] {
  // Docker Compose requires --all to include exited containers in ps output.
  // podman-compose does not support --all and includes exited containers by
  // default (verified with podman-compose 1.3+), so we omit it for podman.
  const base = composeArgs('status');
  if (containerTool === 'docker') {
    base.splice(-2, 0, '--all');
  }
  return base;
}

export function composeArgs(action: string, opts: LogsOptions = {}): string[] {
  const {
    includeAll = false,
    showRhdh = false,
    showInstaller = false,
    follow = false,
  } = opts;
  const files = [
    'compose',
    '-f',
    'compose.yaml',
    '-f',
    'compose-dynamic-plugins-root.yaml',
  ];
  switch (action) {
    case 'start':
      return [...files, 'up', '-d'];
    case 'stop':
      return [...files, 'stop'];
    case 'install-dynamic-plugins':
      return ['container', 'start', '--attach', 'rhdh-plugins-installer'];
    case 'stop-rhdh':
      return [...files, 'stop', 'rhdh'];
    case 'start-rhdh':
      return [...files, 'start', 'rhdh'];
    case 'logs': {
      let services: string[] = [];
      if (!includeAll) {
        services = showRhdh || showInstaller ? [] : ['rhdh'];
        if (showInstaller) services.push('install-dynamic-plugins');
        if (showRhdh) services.push('rhdh');
      }
      return [...files, 'logs', ...(follow ? ['--follow'] : []), ...services];
    }
    case 'status':
      return [...files, 'ps', '--format', 'json'];
    case 'clean':
      return [...files, 'down'];
    default:
      throw new Error(
        `Unknown plugin dev action: ${action}. Use start, update, stop, logs, or status.`,
      );
  }
}

type ComposeService = {
  Service?: string;
  Name?: string;
  Names?: string | string[];
  State?: string;
  Status?: string;
  ExitCode?: number | string;
  Health?: string;
};

export function parseComposeStatus(output: string): ComposeService[] {
  const trimmed = output.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error(
        `Unexpected non-JSON array output from compose status: ${trimmed.slice(0, 120)}`,
      );
    }
  }
  return trimmed
    .split('\n')
    .filter(line => line.trim().startsWith('{'))
    .map(line => {
      try {
        return JSON.parse(line) as ComposeService;
      } catch {
        throw new Error(
          `Unexpected non-JSON output from compose status: ${line}`,
        );
      }
    });
}

export function formatRuntimeStatus(services: ComposeService[]): string {
  const names = (item: ComposeService) =>
    Array.isArray(item.Names) ? item.Names : (item.Names?.split(',') ?? []);
  const service = (...serviceNames: string[]) =>
    services.find(
      item =>
        serviceNames.includes(item.Service ?? '') ||
        serviceNames.includes(item.Name ?? '') ||
        names(item).some(name => serviceNames.includes(name)),
    );
  const rhdh = service('rhdh');
  const installer = service(
    'install-dynamic-plugins',
    'rhdh-plugins-installer',
  );
  const state = (item: ComposeService | undefined) =>
    (item?.State ?? item?.Status ?? '').toLowerCase();
  const exitCode = (item: ComposeService | undefined) =>
    item?.ExitCode === undefined ? undefined : String(item.ExitCode);

  if (
    state(installer).includes('exited') &&
    exitCode(installer) !== undefined &&
    exitCode(installer) !== '0'
  ) {
    const installerCode = exitCode(installer);
    const installerDetail = installerCode
      ? ` (exit code ${installerCode})`
      : '';
    return `Plugin installation failed${installerDetail}. Run \`rhdh-cli plugin dev logs --installer\` for details.`;
  }
  if (state(rhdh).includes('running')) {
    if (state(installer).includes('running')) {
      return 'RHDH Local is starting while dynamic plugins are installed.';
    }
    const healthDetail = rhdh?.Health ? ` (${rhdh.Health})` : '';
    return `RHDH Local is running${healthDetail}.`;
  }
  if (rhdh) {
    const rhdhCode = exitCode(rhdh);
    const rhdhDetail = rhdhCode ? ` (exit code ${rhdhCode})` : '';
    return `RHDH Local stopped${rhdhDetail}. Run \`rhdh-cli plugin dev logs --rhdh\` for details.`;
  }
  return 'RHDH Local is not running.';
}

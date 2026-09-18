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
import path from 'path';
import YAML from 'yaml';

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

export async function command(action: string | undefined, opts: OptionValues) {
  const runtimeDir = await validateRuntime(
    resolveRuntimeDir(opts.rhdhLocalDir),
  );
  const containerTool = validateContainerTool(opts.containerTool);
  const commandAction = action ?? 'start';
  const actions = actionsToRun(commandAction, opts.clean);

  if (commandAction === 'start' || commandAction === 'update') {
    await validateProjectFiles();
    await ensureGeneratedConfigIncluded(runtimeDir, opts.configure);
    await exportCommand({
      build: true,
      install: true,
    });
    await stagePlugin(runtimeDir);
  }

  if (commandAction === 'status') {
    Task.log(await getRuntimeStatus(containerTool, runtimeDir));
    return;
  }

  for (const actionToRun of actions) {
    await run(
      containerTool,
      composeArgs(actionToRun, opts.all, opts.rhdh, opts.installer, opts.follow),
      {
        cwd: runtimeDir,
        shell: false,
      },
    );
  }
  if (actions.includes('clean')) {
    Task.log(
      'Stopped the RHDH Local runtime without removing volumes, configuration, or dynamic plugin artifacts.',
    );
  }
  if (commandAction === 'update') {
    Task.log(await getRuntimeStatus(containerTool, runtimeDir));
  }
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

export function composeStatusArgs(containerTool: string): string[] {
  const args = composeArgs('status');
  if (containerTool === 'docker') args.splice(-2, 0, '--all');
  return args;
}

export async function validateProjectFiles(): Promise<void> {
  const packageJson = await fs.readJson(paths.resolveTarget('package.json'));
  const role: string | undefined = packageJson?.backstage?.role;
  const isBackend =
    role === 'backend-plugin' || role === 'backend-plugin-module';
  if (isBackend) {
    const distTypes = paths.resolveTarget('dist-types');
    if (!(await fs.pathExists(distTypes))) {
      throw new Error(
        `${distTypes} not found. Run \`yarn tsc\` in the plugin directory before using \`plugin dev\`.`,
      );
    }
  }
}

export async function stagePlugin(runtimeDir: string): Promise<void> {
  const packageJson = await fs.readJson(paths.resolveTarget('package.json'));
  const pluginName = packageJson.name.replace(/^@/, '').replaceAll('/', '-');
  const source = paths.resolveTarget('dist-dynamic');
  const destination = path.join(runtimeDir, 'local-plugins', pluginName);
  if (!(await fs.pathExists(source))) {
    throw new Error(`Plugin export did not create ${source}.`);
  }
  // Remove any existing staged copy before copying — fs.copy with overwrite
  // mishandles relative symlinks (e.g. .bin/ entries) when the destination
  // already exists and contains matching symlinks.
  await fs.remove(destination);
  await fs.copy(source, destination, { dereference: false });
  await fs.chmod(destination, 0o755);
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

export function actionsToRun(action: string, clean: boolean): string[] {
  if (clean && action !== 'stop') {
    throw new Error('--clean is only supported with plugin dev stop.');
  }
  if (clean) return ['stop', 'clean'];
  if (action === 'update') {
    return ['install-dynamic-plugins', 'stop-rhdh', 'start-rhdh'];
  }
  return [action];
}

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

export function composeArgs(
  action: string,
  includeAll = false,
  showRhdh = false,
  showInstaller = false,
  follow = false,
): string[] {
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
        `Unknown plugin dev action: ${action}. Use start, update, stop, logs, status, or clean.`,
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
  if (trimmed.startsWith('[')) return JSON.parse(trimmed);
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

  if (state(installer).includes('exited') && exitCode(installer) !== '0') {
    return `Plugin installation failed${exitCode(installer) ? ` (exit code ${exitCode(installer)})` : ''}. Run \`rhdh-cli plugin dev logs --installer\` for details.`;
  }
  if (state(rhdh).includes('running')) {
    if (state(installer).includes('running')) {
      return 'RHDH Local is starting while dynamic plugins are installed.';
    }
    return `RHDH Local is running${rhdh?.Health ? ` (${rhdh.Health})` : ''}.`;
  }
  if (rhdh) {
    return `RHDH Local stopped${exitCode(rhdh) ? ` (exit code ${exitCode(rhdh)})` : ''}. Run \`rhdh-cli plugin dev logs --rhdh\` for details.`;
  }
  return 'RHDH Local is not running.';
}

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
import { spawn } from 'node:child_process';
import chokidar from 'chokidar';

import { execFile, run } from '../../lib/run';
import { Task } from '../../lib/tasks';
import { paths } from '../../lib/paths';
import { command as exportCommand } from '../export-dynamic-plugin';

/** Default readiness poll timeout for `waitForRhdhReady`. */
const READY_TIMEOUT_MS = 120_000;
/** Interval between readiness poll attempts. */
const READY_POLL_INTERVAL_MS = 2_000;

/**
 * Read `BASE_URL` from the rhdh-local env files (`default.env`, then `.env`).
 * Falls back to `http://localhost:7007` if neither file defines the key.
 * The `.env` file is optional and may override `default.env` values.
 */
export async function resolveRhdhUrl(runtimeDir: string): Promise<string> {
  const fallback = 'http://localhost:7007';
  let url = fallback;
  for (const name of ['default.env', '.env']) {
    const file = path.join(runtimeDir, name);
    if (!(await fs.pathExists(file))) continue;
    const content = await fs.readFile(file, 'utf8');
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*BASE_URL\s*=\s*(.*)$/);
      const value = match?.[1].trim();
      if (value) url = value.replace(/^["']|["']$/g, '');
    }
  }
  return url;
}

/**
 * Poll `url` until it returns HTTP 2xx, then return the URL.
 * Prints a dot to stdout every `pollIntervalMs` while waiting.
 * Throws if `timeoutMs` elapses without a successful response.
 */
export async function waitForRhdhReady(
  url: string,
  timeoutMs = READY_TIMEOUT_MS,
  pollIntervalMs = READY_POLL_INTERVAL_MS,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`Waiting for ${url} `);
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (res.ok || (res.status >= 200 && res.status < 400)) {
        process.stdout.write(' ready.\n');
        return url;
      }
    } catch {
      // Connection refused, timeout, etc. — keep polling.
    }
    process.stdout.write('.');
    await new Promise<void>(resolve => setTimeout(resolve, pollIntervalMs));
  }
  process.stdout.write('\n');
  throw new Error(
    `RHDH did not become ready at ${url} within ${timeoutMs / 1000}s. ` +
      `Run \`rhdh-cli plugin dev logs --rhdh\` to check for startup errors.`,
  );
}

const requiredRuntimeFiles = [
  'compose.yaml',
  'compose-dynamic-plugins-root.yaml',
  'prepare-and-install-dynamic-plugins.sh',
  'wait-for-plugins-and-start.sh',
];
const generatedConfig = 'configs/dynamic-plugins/rhdh-cli.generated.local.yaml';

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

export async function validateContainerTool(
  containerTool: string,
): Promise<string> {
  if (containerTool !== 'podman' && containerTool !== 'docker') {
    throw new Error(
      `Invalid value for --container-tool: ${containerTool}. Allowed values are: podman, docker`,
    );
  }
  // Verify the tool is actually on PATH before attempting any compose operation.
  // Use execFile silently — a version check produces no useful output for the user.
  try {
    await execFile(containerTool, ['--version'], { shell: false });
  } catch {
    throw new Error(
      `Unable to find ${containerTool} on PATH. Make sure ${containerTool} is installed and available, or pass --container-tool docker if you use Docker instead.`,
    );
  }
  return containerTool;
}

async function resolveAndValidate(opts: OptionValues) {
  const runtimeDir = await validateRuntime(
    resolveRuntimeDir(opts.rhdhLocalDir),
  );
  const containerTool = await validateContainerTool(opts.containerTool);
  return { runtimeDir, containerTool };
}

async function getComposeServices(
  containerTool: string,
  runtimeDir: string,
): Promise<ComposeService[]> {
  const { stdout } = await execFile(
    containerTool,
    composeStatusArgs(containerTool),
    {
      cwd: runtimeDir,
      shell: false,
    },
  );
  return parseComposeStatus(stdout);
}

async function getRuntimeStatus(
  containerTool: string,
  runtimeDir: string,
): Promise<string> {
  return formatRuntimeStatus(
    await getComposeServices(containerTool, runtimeDir),
  );
}

/**
 * Throws unless the `rhdh` Compose service is currently running.
 *
 * `update`'s round-trip (re-export, re-stage, `compose start rhdh`) assumes
 * the runtime was already brought up by `start`. Without this check, running
 * `update`/`update --watch` against a runtime that was never started (or was
 * stopped in another terminal) fails deep inside a raw `compose`/`container`
 * subprocess error instead of a clear, actionable message.
 */
async function ensureRuntimeRunning(
  containerTool: string,
  runtimeDir: string,
): Promise<void> {
  const services = await getComposeServices(containerTool, runtimeDir);
  const rhdh = findComposeService(services, 'rhdh');
  if (!composeServiceState(rhdh).includes('running')) {
    throw new Error(
      'RHDH Local is not running. Run `rhdh-cli plugin dev start` first.',
    );
  }
}

async function compose(
  containerTool: string,
  runtimeDir: string,
  args: string[],
) {
  await run(containerTool, args, { cwd: runtimeDir, shell: false });
}

/**
 * Wait for the `install-dynamic-plugins` container to finish, without
 * needlessly stalling on a re-entrant `start` call.
 *
 * `waitForContainerEvent` subscribes to the container events stream starting
 * *now* — it only sees events emitted after the subscription begins. `compose
 * up -d` is idempotent and won't recreate/restart an already-exited one-shot
 * container, so on a re-entrant `start` against an already-`Running` runtime,
 * the installer's `died` event already happened in a prior invocation and
 * will never be seen again. Without this check, that stalls `start` for the
 * full `waitForContainerEvent` timeout (60s) before its timeout-resolve path
 * lets it proceed anyway.
 *
 * Checking the installer's current Compose state first avoids that stall:
 * if it already reports `exited`, the install already finished (in this run
 * or a previous one) and there's nothing left to wait for.
 */
async function waitForInstallerToFinish(
  containerTool: string,
  runtimeDir: string,
): Promise<void> {
  const services = await getComposeServices(containerTool, runtimeDir);
  const installer = findComposeService(
    services,
    'install-dynamic-plugins',
    'rhdh-plugins-installer',
  );
  if (composeServiceState(installer).includes('exited')) {
    return;
  }
  await waitForContainerEvent(containerTool, 'install-dynamic-plugins', 'died');
}

export async function start(opts: OptionValues) {
  const { runtimeDir, containerTool } = await resolveAndValidate(opts);
  await validateProjectFiles();
  await ensureGeneratedConfigIncluded(runtimeDir, opts.configure);

  Task.log('[1/4] Building and exporting plugin...');
  await exportCommand({ build: true, install: true });
  await stagePlugin(runtimeDir);

  Task.log('[2/4] Starting RHDH Local runtime...');
  await compose(containerTool, runtimeDir, composeArgs('start'));

  Task.log('[3/4] Installing dynamic plugins...');
  await waitForInstallerToFinish(containerTool, runtimeDir);

  Task.log('[4/4] Waiting for RHDH to be ready...');
  const url = await resolveRhdhUrl(runtimeDir);
  await waitForRhdhReady(url);

  Task.log(`\nRHDH is ready at ${url}`);

  if (opts.watch) {
    await watchUpdate(runtimeDir, containerTool);
  }
}

async function runUpdateCycle(
  runtimeDir: string,
  containerTool: string,
  prefix = '',
): Promise<void> {
  await ensureRuntimeRunning(containerTool, runtimeDir);
  await validateProjectFiles();
  // Fail fast if the generated config include is missing — without it, an
  // update re-stages the plugin but RHDH never loads it. Use configure: false
  // so we surface the --configure hint rather than silently writing the file.
  await ensureGeneratedConfigIncluded(runtimeDir, false);
  await exportCommand({ build: true, install: true });
  await stagePlugin(runtimeDir);
  for (const action of ['install-dynamic-plugins', 'stop-rhdh', 'start-rhdh']) {
    await compose(containerTool, runtimeDir, composeArgs(action));
  }
  const url = await resolveRhdhUrl(runtimeDir);
  await waitForRhdhReady(url);
  Task.log(`${prefix}Refresh your browser at ${url}`);
}

export async function update(opts: OptionValues) {
  const { runtimeDir, containerTool } = await resolveAndValidate(opts);
  if (opts.watch) {
    await watchUpdate(runtimeDir, containerTool);
  } else {
    await runUpdateCycle(runtimeDir, containerTool);
  }
}

/**
 * Subscribe to the container runtime event stream and resolve once a specific
 * service emits a specific event action, or when `timeoutMs` elapses.
 *
 * Both Podman and Docker support `--format json` and `--filter label=`.
 * Uses the `com.docker.compose.service` label set by Compose on all containers.
 *
 * @param containerTool - 'podman' or 'docker'
 * @param service       - Compose service name (e.g. 'install-dynamic-plugins')
 * @param eventAction   - Event action to wait for (e.g. 'died', 'cleanup', 'start')
 * @param timeoutMs     - Max wait in ms. 0 means no timeout (wait indefinitely).
 */
export async function waitForContainerEvent(
  containerTool: string,
  service: string,
  eventAction: string,
  timeoutMs = 60_000,
): Promise<void> {
  await new Promise<void>(resolve => {
    const child = spawn(
      containerTool,
      [
        'events',
        '--stream',
        '--format',
        'json',
        '--filter',
        `event=${eventAction}`,
        '--filter',
        `label=com.docker.compose.service=${service}`,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            child.kill();
            resolve();
          }, timeoutMs)
        : undefined;

    let buf = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed) as {
            Action?: string;
            Status?: string;
            Attributes?: Record<string, string>;
          };
          const action = event.Action ?? event.Status ?? '';
          const svc = event.Attributes?.['com.docker.compose.service'] ?? '';
          if (action === eventAction && svc === service) {
            if (timer !== undefined) clearTimeout(timer);
            child.kill();
            resolve();
          }
        } catch {
          // non-JSON line — ignore
        }
      }
    });

    child.on('error', () => {
      if (timer !== undefined) clearTimeout(timer);
      resolve();
    });

    child.on('close', () => {
      if (timer !== undefined) clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Wait until both the `rhdh` and `install-dynamic-plugins` containers have
 * emitted their terminal cleanup event, or until `timeoutMs` elapses.
 *
 * Podman: wait for `cleanup` (fires after `died`, once crun tears down exec.fifo).
 * Docker: wait for `die` (terminal event; no equivalent cleanup step).
 *
 * Only used between back-to-back watch cycles to prevent the crun exec.fifo
 * race condition. Single one-shot `plugin dev update` runs are unaffected.
 */
export async function waitForContainerCleanup(
  containerTool: string,
  timeoutMs: number,
): Promise<void> {
  // Podman emits `cleanup` after `died` once crun has torn down exec.fifo.
  // Docker emits `die` as its terminal container event (no equivalent cleanup).
  const settleEvent = containerTool === 'podman' ? 'cleanup' : 'die';

  await Promise.all([
    waitForContainerEvent(containerTool, 'rhdh', settleEvent, timeoutMs),
    waitForContainerEvent(
      containerTool,
      'install-dynamic-plugins',
      settleEvent,
      timeoutMs,
    ),
  ]);
}

const ignoredWatchSegments = new Set([
  'node_modules',
  'dist',
  'dist-dynamic',
  'dist-types',
]);

/**
 * Predicate for chokidar's `ignored` option.
 *
 * Chokidar v4+ dropped glob-string support for `ignored` — it now only
 * accepts a function, a regex, or a literal path. A glob-style array (e.g.
 * double-star dist/node_modules patterns) is silently accepted but matches
 * nothing, since chokidar no longer interprets `*` as a wildcard there. This
 * checks path segments directly instead, so output directories are actually
 * excluded rather than just documented as excluded.
 */
export function isIgnoredWatchPath(filePath: string): boolean {
  return filePath
    .split(path.sep)
    .some(segment => ignoredWatchSegments.has(segment));
}

/**
 * Render a caught `unknown` value as a human-readable string for log output.
 *
 * Avoids `String(value)` on non-primitive values, which falls back to
 * `Object.prototype.toString()` (`[object Object]`) for plain objects that
 * don't define their own `toString()`.
 */
function describeWatchError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (
    typeof err === 'number' ||
    typeof err === 'boolean' ||
    typeof err === 'bigint'
  ) {
    return String(err);
  }
  try {
    return JSON.stringify(err) ?? 'Unknown error';
  } catch {
    return 'Unknown error';
  }
}

/**
 * Watch source files and run a full update cycle on changes.
 *
 * Design:
 * - Watches src/, package.json, tsconfig*.json, and *.config.* files.
 * - Excludes output directories (node_modules, dist, dist-dynamic,
 *   dist-types) to prevent output-loop triggering.
 * - Events are debounced: the first event in a `debounceMs` window triggers
 *   the cycle; subsequent events within the window are coalesced.
 * - Cycles are serialized: if a cycle is already running when the debounce
 *   fires, the pending change is deferred until the active cycle finishes.
 * - A failed cycle logs the error and continues watching; it does not exit.
 * - SIGINT/SIGTERM cleanly close the watcher and exit.
 *
 * @param debounceMs - Milliseconds to wait after a change before triggering a
 *   cycle. Defaults to 500ms; callers may pass 0 for tests.
 * @param settleTimeoutMs - Maximum milliseconds to wait for container cleanup
 *   events between back-to-back cycles. If the events don't arrive within this
 *   window the next cycle starts anyway. Defaults to 15000ms; callers may pass
 *   0 to skip event-based settling entirely (used in tests).
 */
export async function watchUpdate(
  runtimeDir: string,
  containerTool: string,
  debounceMs = 500,
  settleTimeoutMs = 15_000,
): Promise<void> {
  const watchPaths = [
    paths.resolveTarget('src'),
    paths.resolveTarget('package.json'),
  ];

  Task.log(
    'Watching for changes. Press Ctrl+C to stop.\n' +
      `  Watching: src/, package.json\n` +
      `  Ignored:  node_modules/, dist/, dist-dynamic/, dist-types/`,
  );

  const watcher = chokidar.watch(watchPaths, {
    ignored: isIgnoredWatchPath,
    ignoreInitial: true,
    persistent: true,
  });

  let running = false;
  let pendingChange = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const drainCycles = async () => {
    let keepGoing = true;
    while (keepGoing) {
      running = true;
      pendingChange = false;
      const cycleStart = Date.now();
      try {
        Task.log(`\n[watch] Change detected — starting update cycle...`);
        await runUpdateCycle(runtimeDir, containerTool, '[watch] ');
        Task.log(`[watch] Update complete in ${Date.now() - cycleStart}ms.`);
      } catch (err: unknown) {
        const message = describeWatchError(err);
        Task.log(
          `[watch] Update failed after ${Date.now() - cycleStart}ms: ${message}`,
        );
        Task.log('[watch] Watching for further changes...');
      } finally {
        running = false;
      }
      keepGoing = pendingChange;
      if (keepGoing) {
        Task.log(
          `[watch] Change received during cycle — waiting for runtime to settle...`,
        );
        if (settleTimeoutMs > 0) {
          await waitForContainerCleanup(containerTool, settleTimeoutMs);
        }
      }
    }
  };

  const scheduleUpdate = () => {
    if (debounceTimer !== undefined) return; // already scheduled
    debounceTimer = setTimeout(async () => {
      debounceTimer = undefined;
      if (running) {
        // A cycle is active — record the intent and let the cycle's finally
        // block start another one when it finishes.
        pendingChange = true;
        return;
      }
      await drainCycles();
    }, debounceMs);
  };

  watcher.on('all', (_event, filePath) => {
    Task.log(`[watch] ${filePath} changed`);
    scheduleUpdate();
  });

  watcher.on('error', (err: unknown) => {
    const message = describeWatchError(err);
    Task.log(`[watch] Watcher error: ${message}`);
  });

  const shutdown = async () => {
    Task.log('\n[watch] Shutting down...');
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
    }
    await watcher.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process alive while the watcher is active.
  await new Promise<void>((_resolve, reject) => {
    watcher.on('error', reject);
  });
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
  await ensureRuntimeRunning(containerTool, runtimeDir);
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
      `Add ${generatedConfig} to ${override}'s includes list, or run ` +
        '`rhdh-cli plugin dev start --configure`.',
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

function composeServiceNames(item: ComposeService): string[] {
  return Array.isArray(item.Names)
    ? item.Names
    : (item.Names?.split(',') ?? []);
}

function findComposeService(
  services: ComposeService[],
  ...serviceNames: string[]
): ComposeService | undefined {
  return services.find(
    item =>
      serviceNames.includes(item.Service ?? '') ||
      serviceNames.includes(item.Name ?? '') ||
      composeServiceNames(item).some(name => serviceNames.includes(name)),
  );
}

function composeServiceState(item: ComposeService | undefined): string {
  return (item?.State ?? item?.Status ?? '').toLowerCase();
}

function composeServiceExitCode(
  item: ComposeService | undefined,
): string | undefined {
  return item?.ExitCode === undefined ? undefined : String(item.ExitCode);
}

export function formatRuntimeStatus(services: ComposeService[]): string {
  const rhdh = findComposeService(services, 'rhdh');
  const installer = findComposeService(
    services,
    'install-dynamic-plugins',
    'rhdh-plugins-installer',
  );
  const state = composeServiceState;
  const exitCode = composeServiceExitCode;

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

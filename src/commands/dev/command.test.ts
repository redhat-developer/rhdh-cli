import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import EventEmitter from 'node:events';
import chokidar from 'chokidar';

jest.mock('../../lib/paths', () => ({
  paths: {
    get targetDir() {
      return (global as any).__pluginDevTestDir ?? os.tmpdir();
    },
    get targetRoot() {
      return (
        (global as any).__pluginDevTestRoot ??
        (global as any).__pluginDevTestDir ??
        os.tmpdir()
      );
    },
    resolveTarget: (...segments: string[]) =>
      path.join((global as any).__pluginDevTestDir ?? os.tmpdir(), ...segments),
  },
}));

jest.mock('../../lib/tasks', () => {
  const original = jest.requireActual('../../lib/tasks');
  return {
    ...original,
    Task: {
      ...original.Task,
      log: jest.fn(),
      forCommand: jest.fn(),
    },
  };
});

jest.mock('../../lib/run', () => ({
  execFile: jest.fn(),
  run: jest.fn(),
}));

jest.mock('../export-dynamic-plugin', () => ({
  command: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Chokidar mock used by watchUpdate tests
// ---------------------------------------------------------------------------
class FakeWatcher extends EventEmitter {
  close = jest.fn().mockResolvedValue(undefined);
}
let fakeWatcher: FakeWatcher;

jest.mock('chokidar', () => ({
  __esModule: true,
  default: {
    watch: jest.fn(() => {
      fakeWatcher = new FakeWatcher();
      return fakeWatcher;
    }),
  },
}));

// ---------------------------------------------------------------------------
// node:child_process spawn mock used by waitForContainerCleanup tests
// ---------------------------------------------------------------------------
class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  kill = jest.fn();
}
let fakeChild: FakeChildProcess;

jest.mock('node:child_process', () => ({
  spawn: jest.fn(() => {
    fakeChild = new FakeChildProcess();
    return fakeChild;
  }),
}));

import {
  composeArgs,
  composeStatusArgs,
  formatRuntimeStatus,
  parseComposeStatus,
  resolveDistTypes,
  resolveRuntimeDir,
  stagePlugin,
  validateContainerTool,
  validateProjectFiles,
  validateRuntime,
  ensureGeneratedConfigIncluded,
  updateGeneratedConfig,
  stop,
  status,
  start,
  update,
  restart,
  watchUpdate,
  waitForContainerEvent,
  waitForContainerCleanup,
  resolveRhdhUrl,
  waitForRhdhReady,
  isIgnoredWatchPath,
} from './command';
import { Task } from '../../lib/tasks';
import { run, execFile } from '../../lib/run';
import { ExitCodeError } from '../../lib/errors';

describe('plugin dev', () => {
  it('builds Compose commands with the RHDH Local dynamic plugin override', () => {
    expect(composeArgs('start')).toEqual([
      'compose',
      '-f',
      'compose.yaml',
      '-f',
      'compose-dynamic-plugins-root.yaml',
      'up',
      '-d',
    ]);
    expect(composeArgs('clean')).toEqual([
      'compose',
      '-f',
      'compose.yaml',
      '-f',
      'compose-dynamic-plugins-root.yaml',
      'down',
    ]);
    expect(composeArgs('install-dynamic-plugins')).toEqual([
      'container',
      'start',
      '--attach',
      'rhdh-plugins-installer',
    ]);
    expect(composeArgs('stop-rhdh')).toContain('rhdh');
    expect(composeArgs('start-rhdh')).toContain('rhdh');
    expect(composeArgs('logs')).toEqual([
      'compose',
      '-f',
      'compose.yaml',
      '-f',
      'compose-dynamic-plugins-root.yaml',
      'logs',
      'rhdh',
    ]);
    expect(composeArgs('logs', { follow: true })).toEqual([
      'compose',
      '-f',
      'compose.yaml',
      '-f',
      'compose-dynamic-plugins-root.yaml',
      'logs',
      '--follow',
      'rhdh',
    ]);
    expect(composeArgs('status')).toEqual([
      'compose',
      '-f',
      'compose.yaml',
      '-f',
      'compose-dynamic-plugins-root.yaml',
      'ps',
      '--format',
      'json',
    ]);
    expect(composeStatusArgs('docker')).toEqual([
      'compose',
      '-f',
      'compose.yaml',
      '-f',
      'compose-dynamic-plugins-root.yaml',
      'ps',
      '--all',
      '--format',
      'json',
    ]);
    expect(composeStatusArgs('podman')).toEqual([
      'compose',
      '-f',
      'compose.yaml',
      '-f',
      'compose-dynamic-plugins-root.yaml',
      'ps',
      '--format',
      'json',
    ]);
    expect(composeArgs('logs', { showInstaller: true })).toContain(
      'install-dynamic-plugins',
    );
    expect(
      composeArgs('logs', { showRhdh: true, showInstaller: true }),
    ).toEqual([
      'compose',
      '-f',
      'compose.yaml',
      '-f',
      'compose-dynamic-plugins-root.yaml',
      'logs',
      'install-dynamic-plugins',
      'rhdh',
    ]);
  });

  it('reports actionable RHDH Local lifecycle state', () => {
    expect(formatRuntimeStatus([])).toBe('RHDH Local is not running.');
    expect(
      formatRuntimeStatus([
        { Service: 'install-dynamic-plugins', State: 'exited', ExitCode: 1 },
      ]),
    ).toContain('Plugin installation failed (exit code 1)');
    expect(
      formatRuntimeStatus([
        { Names: ['rhdh'], State: 'running', Health: 'healthy' },
        {
          Names: ['rhdh-plugins-installer'],
          State: 'exited',
          ExitCode: 0,
        },
      ]),
    ).toBe('RHDH Local is running (healthy).');
    // An exited installer with no ExitCode field must not be misreported as a failure.
    expect(
      formatRuntimeStatus([
        { Names: ['rhdh'], State: 'running' },
        { Names: ['rhdh-plugins-installer'], State: 'exited' },
      ]),
    ).toBe('RHDH Local is running.');
  });

  it('parses Docker Compose JSON Lines status output', () => {
    expect(
      parseComposeStatus(
        '{"Service":"rhdh","State":"running"}\n{"Service":"install-dynamic-plugins","State":"exited","ExitCode":1}',
      ),
    ).toEqual([
      { Service: 'rhdh', State: 'running' },
      {
        Service: 'install-dynamic-plugins',
        State: 'exited',
        ExitCode: 1,
      },
    ]);
  });

  it('filters non-JSON lines from compose status output', () => {
    expect(
      parseComposeStatus(
        'WARN[0000] Some deprecation warning\n{"Service":"rhdh","State":"running"}\n',
      ),
    ).toEqual([{ Service: 'rhdh', State: 'running' }]);
  });

  it('parses Podman Compose JSON array status output', () => {
    expect(
      parseComposeStatus(
        '[{"Service":"rhdh","State":"running"},{"Service":"install-dynamic-plugins","State":"exited","ExitCode":0}]',
      ),
    ).toEqual([
      { Service: 'rhdh', State: 'running' },
      { Service: 'install-dynamic-plugins', State: 'exited', ExitCode: 0 },
    ]);
  });

  it('throws a compose-specific error for malformed JSON array status output', () => {
    expect(() => parseComposeStatus('[not json')).toThrow(
      'Unexpected non-JSON array output from compose status',
    );
  });

  it('rejects unknown actions', () => {
    expect(() => composeArgs('remove-volumes')).toThrow(
      'Unknown plugin dev action',
    );
  });

  it('rejects an invalid container tool value', async () => {
    await expect(validateContainerTool('buildah')).rejects.toThrow(
      'Allowed values',
    );
  });

  it('rejects a container tool that is not on PATH', async () => {
    const execFileMock = execFile as jest.MockedFunction<typeof execFile>;
    execFileMock.mockRejectedValueOnce(new Error('command not found'));
    await expect(validateContainerTool('docker')).rejects.toThrow(
      'Unable to find docker on PATH',
    );
  });

  it('accepts a container tool that is on PATH', async () => {
    const execFileMock = execFile as jest.MockedFunction<typeof execFile>;
    execFileMock.mockResolvedValueOnce({
      stdout: 'podman version 5.0.0',
      stderr: '',
    });
    await expect(validateContainerTool('podman')).resolves.toBe('podman');
  });

  it('uses the command option before RHDH_LOCAL_DIR', () => {
    const previous = process.env.RHDH_LOCAL_DIR;
    try {
      process.env.RHDH_LOCAL_DIR = '/from-environment';
      expect(resolveRuntimeDir('/from-option')).toBe('/from-option');
      expect(resolveRuntimeDir(undefined)).toBe('/from-environment');
      delete process.env.RHDH_LOCAL_DIR;
      expect(() => resolveRuntimeDir(undefined)).toThrow('RHDH_LOCAL_DIR');
    } finally {
      if (previous === undefined) {
        delete process.env.RHDH_LOCAL_DIR;
      } else {
        process.env.RHDH_LOCAL_DIR = previous;
      }
    }
  });

  describe('lifecycle handlers with mocked child processes', () => {
    let runtimeDir: string;
    const mockRun = run as jest.MockedFunction<typeof run>;
    const mockExecFile = execFile as jest.MockedFunction<typeof execFile>;
    const mockTask = Task as jest.Mocked<typeof Task>;

    beforeEach(async () => {
      runtimeDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'plugin-dev-runtime-'),
      );
      // Create the required runtime files so validateRuntime passes
      for (const f of [
        'compose.yaml',
        'compose-dynamic-plugins-root.yaml',
        'prepare-and-install-dynamic-plugins.sh',
        'wait-for-plugins-and-start.sh',
      ]) {
        await fs.writeFile(path.join(runtimeDir, f), '');
      }
      mockRun.mockReset();
      mockExecFile.mockReset();
      // validateContainerTool now uses execFile for the silent version check.
      // Default to resolving so subcommand tests don't need to set it up themselves.
      mockExecFile.mockResolvedValue({
        stdout: 'podman version 5.0.0',
        stderr: '',
      });
      mockTask.forCommand.mockResolvedValue(undefined);
      mockTask.log.mockReset();
    });

    afterEach(async () => {
      await fs.remove(runtimeDir);
    });

    it('stop rejects when the compose child process fails', async () => {
      const err = new ExitCodeError(1, 'podman compose stop');
      mockRun.mockRejectedValueOnce(err);
      await expect(
        stop({ rhdhLocalDir: runtimeDir, containerTool: 'podman' }),
      ).rejects.toThrow(ExitCodeError);
    });

    it('status rejects when the compose child process fails', async () => {
      const err = new ExitCodeError(1, 'podman compose ps');
      // First call: version check (passes); second call: compose ps (fails).
      mockExecFile
        .mockResolvedValueOnce({ stdout: 'podman version 5.0.0', stderr: '' })
        .mockRejectedValueOnce(err);
      await expect(
        status({ rhdhLocalDir: runtimeDir, containerTool: 'podman' }),
      ).rejects.toThrow(ExitCodeError);
    });

    it('update rejects with an actionable message when RHDH Local is not running', async () => {
      // First call: version check (passes); second call: compose ps reports
      // no services at all (RHDH Local was never started).
      mockExecFile
        .mockResolvedValueOnce({ stdout: 'podman version 5.0.0', stderr: '' })
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' });
      await expect(
        update({ rhdhLocalDir: runtimeDir, containerTool: 'podman' }),
      ).rejects.toThrow('RHDH Local is not running');
    });

    it('update rejects when RHDH Local is stopped (not just absent)', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: 'podman version 5.0.0', stderr: '' })
        .mockResolvedValueOnce({
          stdout: JSON.stringify([
            { Service: 'rhdh', State: 'exited', ExitCode: 0 },
          ]),
          stderr: '',
        });
      await expect(
        update({ rhdhLocalDir: runtimeDir, containerTool: 'podman' }),
      ).rejects.toThrow('RHDH Local is not running');
    });

    it('restart rejects with an actionable message when RHDH Local is not running', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: 'podman version 5.0.0', stderr: '' })
        .mockResolvedValueOnce({ stdout: '[]', stderr: '' });
      await expect(
        restart({ rhdhLocalDir: runtimeDir, containerTool: 'podman' }),
      ).rejects.toThrow('RHDH Local is not running');
      expect(mockRun).not.toHaveBeenCalled();
    });

    it('restart stops and starts rhdh when RHDH Local is running', async () => {
      // version check, then two compose-ps calls: the pre-flight check, then
      // the final getRuntimeStatus call after stop-rhdh/start-rhdh.
      mockExecFile
        .mockResolvedValueOnce({ stdout: 'podman version 5.0.0', stderr: '' })
        .mockResolvedValueOnce({
          stdout: JSON.stringify([{ Service: 'rhdh', State: 'running' }]),
          stderr: '',
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify([{ Service: 'rhdh', State: 'running' }]),
          stderr: '',
        });
      mockRun.mockResolvedValue(undefined);
      await expect(
        restart({ rhdhLocalDir: runtimeDir, containerTool: 'podman' }),
      ).resolves.toBeUndefined();
      expect(mockRun).toHaveBeenCalledTimes(2);
    });
  });

  it('reports the RHDH Local files missing from an incompatible directory', async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'plugin-dev-test-'),
    );
    await expect(validateRuntime(directory)).rejects.toThrow(
      'compose-dynamic-plugins-root.yaml',
    );
    await fs.remove(directory);
  });

  it('adds the generated configuration include only when explicitly requested', async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'plugin-dev-test-'),
    );
    const override = path.join(
      directory,
      'configs/dynamic-plugins/dynamic-plugins.override.yaml',
    );
    await fs.outputFile(
      override,
      'includes:\n  - dynamic-plugins.default.yaml\nplugins: []\n',
    );
    await expect(
      ensureGeneratedConfigIncluded(directory, false),
    ).rejects.toThrow('plugin dev start --configure');
    await ensureGeneratedConfigIncluded(directory, true);
    await expect(fs.readFile(override, 'utf8')).resolves.toContain(
      'rhdh-cli.generated.local.yaml',
    );
    await fs.remove(directory);
  });

  it('always refreshes a staged local plugin', async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'plugin-dev-test-'),
    );
    const config = path.join(
      directory,
      'configs/dynamic-plugins/rhdh-cli.generated.local.yaml',
    );

    await updateGeneratedConfig(directory, './local-plugins/example');
    await expect(fs.readFile(config, 'utf8')).resolves.toContain(
      'pullPolicy: Always',
    );
    await fs.remove(directory);
  });

  it('requires dist-types for backend plugins before exporting', async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'plugin-dev-test-'),
    );
    (global as any).__pluginDevTestDir = directory;
    try {
      await fs.writeJson(path.join(directory, 'package.json'), {
        name: '@internal/my-plugin',
        version: '0.1.0',
        backstage: { role: 'backend-plugin' },
      });
      await expect(validateProjectFiles()).rejects.toThrow('yarn tsc');

      await fs.ensureDir(path.join(directory, 'dist-types'));
      await expect(validateProjectFiles()).resolves.toBeUndefined();
    } finally {
      delete (global as any).__pluginDevTestDir;
      await fs.remove(directory);
    }
  });

  it('does not require dist-types for frontend plugins', async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'plugin-dev-test-'),
    );
    (global as any).__pluginDevTestDir = directory;
    try {
      await fs.writeJson(path.join(directory, 'package.json'), {
        name: '@internal/my-plugin',
        version: '0.1.0',
        backstage: { role: 'frontend-plugin' },
      });
      await expect(validateProjectFiles()).resolves.toBeUndefined();
    } finally {
      delete (global as any).__pluginDevTestDir;
      await fs.remove(directory);
    }
  });

  it('resolves dist-types inside plugin dir for standalone projects', () => {
    const pluginDir = '/tmp/my-plugin';
    (global as any).__pluginDevTestDir = pluginDir;
    // targetRoot === targetDir in standalone — dist-types is inside the plugin
    expect(resolveDistTypes()).toBe(path.join(pluginDir, 'dist-types'));
    delete (global as any).__pluginDevTestDir;
  });

  it('resolves dist-types at monorepo workspace root for monorepo packages', () => {
    const workspaceRoot = '/tmp/my-workspace';
    const pluginDir = path.join(workspaceRoot, 'plugins', 'my-backend');
    (global as any).__pluginDevTestRoot = workspaceRoot;
    (global as any).__pluginDevTestDir = pluginDir;
    // targetRoot !== targetDir — dist-types mirrors the plugin's path under root
    expect(resolveDistTypes()).toBe(
      path.join(workspaceRoot, 'dist-types', 'plugins', 'my-backend'),
    );
    delete (global as any).__pluginDevTestDir;
    delete (global as any).__pluginDevTestRoot;
  });

  it('finds dist-types in monorepo workspace root for backend plugins', async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'plugin-dev-root-'),
    );
    const pluginDir = path.join(workspaceRoot, 'plugins', 'my-backend');
    await fs.ensureDir(pluginDir);
    (global as any).__pluginDevTestRoot = workspaceRoot;
    (global as any).__pluginDevTestDir = pluginDir;
    try {
      await fs.writeJson(path.join(pluginDir, 'package.json'), {
        name: '@internal/my-backend',
        version: '0.1.0',
        backstage: { role: 'backend-plugin' },
      });
      // No dist-types yet — should fail with a clear message
      await expect(validateProjectFiles()).rejects.toThrow('dist-types');

      // Create dist-types at the monorepo root (mirroring rootDir: ".")
      await fs.ensureDir(
        path.join(workspaceRoot, 'dist-types', 'plugins', 'my-backend'),
      );
      await expect(validateProjectFiles()).resolves.toBeUndefined();
    } finally {
      delete (global as any).__pluginDevTestDir;
      delete (global as any).__pluginDevTestRoot;
      await fs.remove(workspaceRoot);
    }
  });

  async function withStagingDirs(
    packageName: string,
    fn: (srcDir: string, runtimeDir: string) => Promise<void>,
  ) {
    const srcDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-dev-src-'));
    const runtimeDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'plugin-dev-runtime-'),
    );
    (global as any).__pluginDevTestDir = srcDir;
    try {
      await fs.writeJson(path.join(srcDir, 'package.json'), {
        name: packageName,
        version: '0.1.0',
        backstage: { role: 'backend-plugin' },
      });
      await fn(srcDir, runtimeDir);
    } finally {
      delete (global as any).__pluginDevTestDir;
      await fs.remove(srcDir);
      await fs.remove(runtimeDir);
    }
  }

  it('copies staged plugin without following symlinks', async () => {
    await withStagingDirs('@internal/my-plugin', async (srcDir, runtimeDir) => {
      // Simulate a dist-dynamic layout with a .bin symlink
      await fs.ensureDir(
        path.join(srcDir, 'dist-dynamic', 'node_modules', '.bin'),
      );
      await fs.ensureDir(
        path.join(srcDir, 'dist-dynamic', 'node_modules', 'mime'),
      );
      await fs.writeFile(
        path.join(srcDir, 'dist-dynamic', 'node_modules', 'mime', 'cli.js'),
        '#!/usr/bin/env node',
      );
      await fs.symlink(
        '../mime/cli.js',
        path.join(srcDir, 'dist-dynamic', 'node_modules', '.bin', 'mime'),
      );
      await fs.ensureDir(path.join(srcDir, 'dist-dynamic', 'dist'));

      await stagePlugin(runtimeDir);

      const stagedBin = path.join(
        runtimeDir,
        'local-plugins',
        'internal-my-plugin',
        'node_modules',
        '.bin',
        'mime',
      );
      const stat = await fs.lstat(stagedBin);
      expect(stat.isSymbolicLink()).toBe(true);
      expect(await fs.readlink(stagedBin)).toBe('../mime/cli.js');

      // Second call (simulating update) must not fail on existing symlink
      await expect(stagePlugin(runtimeDir)).resolves.toBeUndefined();
    });
  });

  it('rejects package names that would resolve at or outside local-plugins/', async () => {
    for (const badName of ['..', '@']) {
      await withStagingDirs(badName, async (srcDir, runtimeDir) => {
        await fs.ensureDir(path.join(srcDir, 'dist-dynamic'));
        await expect(stagePlugin(runtimeDir)).rejects.toThrow('not inside');
      });
    }
  });
});

// ---------------------------------------------------------------------------
// isIgnoredWatchPath — chokidar v4+ dropped glob-string support for `ignored`;
// this is a regression test for that (a glob array previously matched nothing).
// ---------------------------------------------------------------------------

describe('isIgnoredWatchPath', () => {
  it('ignores paths under output/dependency directories', () => {
    expect(isIgnoredWatchPath(path.join('plugin', 'dist', 'output.js'))).toBe(
      true,
    );
    expect(
      isIgnoredWatchPath(path.join('plugin', 'dist-dynamic', 'package.json')),
    ).toBe(true);
    expect(
      isIgnoredWatchPath(path.join('plugin', 'dist-types', 'index.d.ts')),
    ).toBe(true);
    expect(
      isIgnoredWatchPath(
        path.join('plugin', 'node_modules', 'pkg', 'index.js'),
      ),
    ).toBe(true);
  });

  it('does not ignore ordinary watched paths', () => {
    expect(isIgnoredWatchPath(path.join('plugin', 'src', 'index.ts'))).toBe(
      false,
    );
    expect(isIgnoredWatchPath(path.join('plugin', 'package.json'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// watchUpdate — file-watching behaviour
// ---------------------------------------------------------------------------

describe('watchUpdate', () => {
  let runtimeDir: string;
  const mockRun = run as jest.MockedFunction<typeof run>;
  const mockExecFile = execFile as jest.MockedFunction<typeof execFile>;
  const mockTask = Task as jest.Mocked<typeof Task>;
  const mockExport = jest.requireMock('../export-dynamic-plugin')
    .command as jest.MockedFunction<() => Promise<void>>;

  let pluginDir: string;

  beforeEach(async () => {
    runtimeDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'plugin-dev-watch-runtime-'),
    );
    pluginDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'plugin-dev-watch-plugin-'),
    );
    (global as any).__pluginDevTestDir = pluginDir;

    for (const f of [
      'compose.yaml',
      'compose-dynamic-plugins-root.yaml',
      'prepare-and-install-dynamic-plugins.sh',
      'wait-for-plugins-and-start.sh',
    ]) {
      await fs.writeFile(path.join(runtimeDir, f), '');
    }

    // Write the generated config include so ensureGeneratedConfigIncluded passes
    const override = path.join(
      runtimeDir,
      'configs/dynamic-plugins/dynamic-plugins.override.yaml',
    );
    await fs.outputFile(
      override,
      `includes:\n  - configs/dynamic-plugins/rhdh-cli.generated.local.yaml\n`,
    );

    // Write a minimal frontend plugin package.json so validateProjectFiles passes
    // (frontend plugins do not require dist-types).
    await fs.writeJson(path.join(pluginDir, 'package.json'), {
      name: '@internal/my-watch-plugin',
      version: '0.1.0',
      backstage: { role: 'frontend-plugin' },
    });

    mockRun.mockReset();
    mockExecFile.mockReset();
    mockTask.forCommand.mockResolvedValue(undefined);
    mockTask.log.mockReset();
    mockExport.mockReset();

    // Default: export + compose succeed; compose ps reports rhdh running so
    // ensureRuntimeRunning's pre-flight check passes.
    mockExport.mockResolvedValue(undefined);
    mockRun.mockResolvedValue(undefined);
    mockExecFile.mockResolvedValue({
      stdout: JSON.stringify([{ Service: 'rhdh', State: 'running' }]),
      stderr: '',
    });
  });

  afterEach(async () => {
    delete (global as any).__pluginDevTestDir;
    // Remove signal listeners added by watchUpdate to avoid accumulation
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    await fs.remove(runtimeDir);
    await fs.remove(pluginDir);
  });

  /**
   * Wait until mockExport has been called at least `count` times by polling
   * with setImmediate-based yields. We pass debounceMs=0 to watchUpdate so the
   * setTimeout fires on the very next event loop tick; real timers mean fs-extra
   * and other async operations resolve normally.
   */
  async function waitForExportCalls(count: number, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (mockExport.mock.calls.length < count) {
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for mockExport to be called ${count} time(s) ` +
            `(called ${mockExport.mock.calls.length} time(s))`,
        );
      }
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }

  it('runs an update cycle when a file change event fires', async () => {
    // debounceMs=0 so the timer fires on the next event-loop tick.
    const watchPromise = watchUpdate(runtimeDir, 'podman', 0, 0);

    fakeWatcher.emit('all', 'change', 'src/index.ts');
    await waitForExportCalls(1);

    expect(mockExport).toHaveBeenCalledTimes(1);

    fakeWatcher.emit('error', new Error('done'));
    await expect(watchPromise).rejects.toThrow('done');
  });

  it('debounces rapid consecutive file events into a single cycle', async () => {
    // Use debounceMs=20 so rapid events within that window coalesce, but the
    // cycle still completes quickly in real-timer mode.
    const watchPromise = watchUpdate(runtimeDir, 'podman', 20, 0);

    // Three events fired rapidly — only the first one should schedule a timer
    // (the guard `if (debounceTimer !== undefined) return` drops the rest).
    fakeWatcher.emit('all', 'change', 'src/a.ts');
    fakeWatcher.emit('all', 'change', 'src/b.ts');
    fakeWatcher.emit('all', 'change', 'src/c.ts');
    await waitForExportCalls(1);

    expect(mockExport).toHaveBeenCalledTimes(1);

    fakeWatcher.emit('error', new Error('done'));
    await expect(watchPromise).rejects.toThrow('done');
  });

  it('continues watching after a failed update cycle', async () => {
    const watchPromise = watchUpdate(runtimeDir, 'podman', 0, 0);

    mockExport.mockRejectedValueOnce(new Error('build exploded'));

    fakeWatcher.emit('all', 'change', 'src/fail.ts');
    await waitForExportCalls(1);

    expect(mockExport).toHaveBeenCalledTimes(1);
    expect(mockTask.log).toHaveBeenCalledWith(
      expect.stringContaining('build exploded'),
    );

    // A second event after the failed cycle should still trigger a new cycle.
    mockExport.mockResolvedValueOnce(undefined);
    fakeWatcher.emit('all', 'change', 'src/fixed.ts');
    await waitForExportCalls(2);

    expect(mockExport).toHaveBeenCalledTimes(2);

    fakeWatcher.emit('error', new Error('done'));
    await expect(watchPromise).rejects.toThrow('done');
  });

  async function waitForTaskLogContaining(substring: string, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (
      !mockTask.log.mock.calls.some(call => String(call[0]).includes(substring))
    ) {
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for a Task.log call containing "${substring}"`,
        );
      }
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }

  it('fails a cycle cleanly and keeps watching when RHDH Local is not running', async () => {
    const watchPromise = watchUpdate(runtimeDir, 'podman', 0, 0);

    // Simulate RHDH Local not running for the first triggered cycle —
    // ensureRuntimeRunning should reject before exportCommand is ever called.
    mockExecFile.mockResolvedValueOnce({ stdout: '[]', stderr: '' });

    fakeWatcher.emit('all', 'change', 'src/index.ts');
    await waitForTaskLogContaining('RHDH Local is not running');
    expect(mockExport).not.toHaveBeenCalled();

    // A subsequent change, with RHDH running again (the default mock), should
    // succeed and the watcher should still be alive to pick it up.
    fakeWatcher.emit('all', 'change', 'src/fixed.ts');
    await waitForExportCalls(1);
    expect(mockExport).toHaveBeenCalledTimes(1);

    fakeWatcher.emit('error', new Error('done'));
    await expect(watchPromise).rejects.toThrow('done');
  });

  it('closes the watcher on SIGINT', async () => {
    watchUpdate(runtimeDir, 'podman', 0, 0);

    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as () => never);

    process.emit('SIGINT');

    // Allow the shutdown async chain to run.
    await new Promise<void>(resolve => setImmediate(resolve));
    await Promise.resolve();

    expect(fakeWatcher.close).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);

    exitSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// start — --watch wiring
// ---------------------------------------------------------------------------

describe('start', () => {
  let runtimeDir: string;
  let pluginDir: string;
  const mockRun = run as jest.MockedFunction<typeof run>;
  const mockExecFile = execFile as jest.MockedFunction<typeof execFile>;
  const mockTask = Task as jest.Mocked<typeof Task>;
  const mockExport = jest.requireMock('../export-dynamic-plugin')
    .command as jest.MockedFunction<() => Promise<void>>;
  const mockFetch = jest.fn<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >();
  const mockChokidarWatch = chokidar.watch as jest.MockedFunction<
    typeof chokidar.watch
  >;

  beforeEach(async () => {
    runtimeDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'plugin-dev-start-runtime-'),
    );
    pluginDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'plugin-dev-start-plugin-'),
    );
    (global as any).__pluginDevTestDir = pluginDir;

    for (const f of [
      'compose.yaml',
      'compose-dynamic-plugins-root.yaml',
      'prepare-and-install-dynamic-plugins.sh',
      'wait-for-plugins-and-start.sh',
    ]) {
      await fs.writeFile(path.join(runtimeDir, f), '');
    }

    const override = path.join(
      runtimeDir,
      'configs/dynamic-plugins/dynamic-plugins.override.yaml',
    );
    await fs.outputFile(
      override,
      `includes:\n  - configs/dynamic-plugins/rhdh-cli.generated.local.yaml\n`,
    );

    await fs.writeJson(path.join(pluginDir, 'package.json'), {
      name: '@internal/my-start-plugin',
      version: '0.1.0',
      backstage: { role: 'frontend-plugin' },
    });
    // stagePlugin requires dist-dynamic to already exist (export is mocked).
    await fs.ensureDir(path.join(pluginDir, 'dist-dynamic'));
    await fs.writeJson(path.join(pluginDir, 'dist-dynamic', 'package.json'), {
      name: '@internal/my-start-plugin',
      version: '0.1.0',
    });

    mockRun.mockReset();
    mockExecFile.mockReset();
    mockTask.forCommand.mockResolvedValue(undefined);
    mockTask.log.mockReset();
    mockExport.mockReset();
    mockChokidarWatch.mockClear();
    (jest.requireMock('node:child_process').spawn as jest.Mock).mockClear();

    mockExport.mockResolvedValue(undefined);
    mockRun.mockResolvedValue(undefined);
    mockExecFile.mockResolvedValue({
      stdout: 'podman version 5.0.0',
      stderr: '',
    });

    mockFetch.mockReset();
    (global as any).fetch = mockFetch;
    mockFetch.mockResolvedValue(
      new Response(null, { status: 200 }) as Response,
    );
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    delete (global as any).__pluginDevTestDir;
    (process.stdout.write as jest.Mock).mockRestore();
    (global as any).fetch = undefined;
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    await fs.remove(runtimeDir);
    await fs.remove(pluginDir);
  });

  const { spawn: spawnMock } = jest.requireMock('node:child_process') as {
    spawn: jest.Mock;
  };

  function emitInstallerDied() {
    const event = JSON.stringify({
      Action: 'died',
      Attributes: { 'com.docker.compose.service': 'install-dynamic-plugins' },
    });
    fakeChild.stdout.emit('data', Buffer.from(`${event}\n`));
  }

  async function waitForCondition(
    check: () => boolean,
    description: string,
    timeoutMs = 5000,
  ) {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for: ${description}`);
      }
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }

  it('enters watch mode after a successful start when --watch is passed', async () => {
    const startPromise = start({
      rhdhLocalDir: runtimeDir,
      containerTool: 'podman',
      watch: true,
    });

    // Phases 1-2 (export/stage/compose-start) involve real fs I/O, so poll
    // rather than assume a fixed number of ticks — wait until phase 3
    // actually spawns the container-events subscription, then satisfy it.
    await waitForCondition(
      () => spawnMock.mock.calls.length > 0,
      'waitForContainerEvent to spawn the events subscription',
    );
    emitInstallerDied();

    // Phase 4's readiness poll resolves on the first mocked fetch; once
    // start() proceeds into watchUpdate, chokidar.watch is called synchronously.
    await waitForCondition(
      () => mockChokidarWatch.mock.calls.length > 0,
      'watchUpdate to call chokidar.watch',
    );

    expect(mockTask.log).toHaveBeenCalledWith(
      expect.stringContaining('RHDH is ready at'),
    );

    fakeWatcher.emit('error', new Error('done'));
    await expect(startPromise).rejects.toThrow('done');
  });

  it('does not enter watch mode when --watch is not passed', async () => {
    const startPromise = start({
      rhdhLocalDir: runtimeDir,
      containerTool: 'podman',
    });

    await waitForCondition(
      () => spawnMock.mock.calls.length > 0,
      'waitForContainerEvent to spawn the events subscription',
    );
    emitInstallerDied();

    await expect(startPromise).resolves.toBeUndefined();
    expect(mockChokidarWatch).not.toHaveBeenCalled();
  });

  it('skips waiting for the installer event when it already exited (re-entrant start)', async () => {
    // version check, then compose ps reporting the installer already exited
    // from a previous `start` — compose up -d won't restart it, so its
    // `died` event will never fire again for a fresh event-stream subscriber.
    mockExecFile
      .mockResolvedValueOnce({ stdout: 'podman version 5.0.0', stderr: '' })
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          { Service: 'install-dynamic-plugins', State: 'exited', ExitCode: 0 },
        ]),
        stderr: '',
      });

    const startPromise = start({
      rhdhLocalDir: runtimeDir,
      containerTool: 'podman',
    });

    await expect(startPromise).resolves.toBeUndefined();
    // Never needed to subscribe to the events stream at all.
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// waitForContainerEvent — single-service event subscription
// ---------------------------------------------------------------------------

describe('waitForContainerEvent', () => {
  function emitEvent(svc: string, action: string) {
    const event = JSON.stringify({
      Action: action,
      Attributes: { 'com.docker.compose.service': svc },
    });
    fakeChild.stdout.emit('data', Buffer.from(`${event}\n`));
  }

  it('resolves when the target service emits the target action', async () => {
    const p = waitForContainerEvent('podman', 'rhdh', 'died', 5000);
    await new Promise<void>(resolve => setImmediate(resolve));
    emitEvent('rhdh', 'died');
    await new Promise<void>(resolve => setImmediate(resolve));
    await expect(p).resolves.toBeUndefined();
    expect(fakeChild.kill).toHaveBeenCalled();
  });

  it('ignores events for other services', async () => {
    const p = waitForContainerEvent('podman', 'rhdh', 'died', 5000);
    await new Promise<void>(resolve => setImmediate(resolve));
    // wrong service — should not resolve
    emitEvent('install-dynamic-plugins', 'died');
    await new Promise<void>(resolve => setImmediate(resolve));
    // correct service
    emitEvent('rhdh', 'died');
    await new Promise<void>(resolve => setImmediate(resolve));
    await expect(p).resolves.toBeUndefined();
  });

  it('resolves on timeout when the event does not arrive', async () => {
    jest.useFakeTimers();
    const p = waitForContainerEvent('podman', 'rhdh', 'died', 1000);
    await Promise.resolve();
    jest.advanceTimersByTime(1100);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await expect(p).resolves.toBeUndefined();
    expect(fakeChild.kill).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('passes the correct event filter to spawn', async () => {
    const { spawn: spawnMock } = jest.requireMock('node:child_process') as {
      spawn: jest.Mock;
    };
    spawnMock.mockClear();

    waitForContainerEvent('docker', 'install-dynamic-plugins', 'die', 5000);
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(spawnMock).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining([
        'event=die',
        'label=com.docker.compose.service=install-dynamic-plugins',
      ]),
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// waitForContainerCleanup — dual-service settle (delegates to waitForContainerEvent)
// ---------------------------------------------------------------------------

describe('waitForContainerCleanup', () => {
  it('uses cleanup for podman and die for docker', async () => {
    const { spawn: spawnMock } = jest.requireMock('node:child_process') as {
      spawn: jest.Mock;
    };
    spawnMock.mockClear();

    // waitForContainerCleanup spawns two parallel waitForContainerEvent calls.
    // Capture each FakeChildProcess instance as spawn is called.
    const children: FakeChildProcess[] = [];
    spawnMock.mockImplementation(() => {
      const child = new FakeChildProcess();
      children.push(child);
      return child;
    });

    const p = waitForContainerCleanup('podman', 5000);
    // Allow both spawns to register their stdout listeners.
    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => setImmediate(resolve));

    const calls = spawnMock.mock.calls as Array<[string, string[]]>;
    expect(calls.every(([tool]) => tool === 'podman')).toBe(true);
    expect(calls.some(([, args]) => args.includes('event=cleanup'))).toBe(true);
    expect(calls.some(([, args]) => args.includes('event=die'))).toBe(false);

    // Emit the cleanup event to each respective child.
    function emitTo(child: FakeChildProcess, svc: string, action = 'cleanup') {
      const event = JSON.stringify({
        Action: action,
        Attributes: { 'com.docker.compose.service': svc },
      });
      child.stdout.emit('data', Buffer.from(`${event}\n`));
    }
    // children[0] watches rhdh, children[1] watches install-dynamic-plugins
    // (or vice-versa depending on Promise.all order — emit to both).
    for (const child of children) {
      emitTo(child, 'rhdh');
      emitTo(child, 'install-dynamic-plugins');
    }
    await new Promise<void>(resolve => setImmediate(resolve));
    await expect(p).resolves.toBeUndefined();

    // Restore the default mock implementation for subsequent tests.
    spawnMock.mockImplementation(() => {
      fakeChild = new FakeChildProcess();
      return fakeChild;
    });
  });
});

// ---------------------------------------------------------------------------
// resolveRhdhUrl — env file parsing
// ---------------------------------------------------------------------------

describe('resolveRhdhUrl', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-dev-url-'));
  });
  afterEach(() => fs.remove(dir));

  it('returns the fallback URL when no env files exist', async () => {
    await expect(resolveRhdhUrl(dir)).resolves.toBe('http://localhost:7007');
  });

  it('reads BASE_URL from default.env', async () => {
    await fs.writeFile(
      path.join(dir, 'default.env'),
      'BASE_URL=http://localhost:9999\n',
    );
    await expect(resolveRhdhUrl(dir)).resolves.toBe('http://localhost:9999');
  });

  it('.env overrides default.env', async () => {
    await fs.writeFile(
      path.join(dir, 'default.env'),
      'BASE_URL=http://localhost:9999\n',
    );
    await fs.writeFile(
      path.join(dir, '.env'),
      '# comment\nBASE_URL=http://my-host:7007\n',
    );
    await expect(resolveRhdhUrl(dir)).resolves.toBe('http://my-host:7007');
  });

  it('ignores commented-out BASE_URL lines', async () => {
    await fs.writeFile(
      path.join(dir, 'default.env'),
      'BASE_URL=http://localhost:7007\n',
    );
    await fs.writeFile(
      path.join(dir, '.env'),
      '# BASE_URL=http://other:1234\n',
    );
    await expect(resolveRhdhUrl(dir)).resolves.toBe('http://localhost:7007');
  });
});

// ---------------------------------------------------------------------------
// waitForRhdhReady — HTTP readiness polling
// ---------------------------------------------------------------------------

describe('waitForRhdhReady', () => {
  const mockFetch = jest.fn<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >();

  beforeEach(() => {
    mockFetch.mockReset();
    // Replace global fetch with the mock for the duration of each test.
    (global as any).fetch = mockFetch;
    // Suppress the dot output during tests.
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    (process.stdout.write as jest.Mock).mockRestore();
    (global as any).fetch = undefined;
  });

  it('resolves with the URL when the first poll returns 200', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 200 }) as Response,
    );
    await expect(
      waitForRhdhReady('http://localhost:7007', 5000, 0),
    ).resolves.toBe('http://localhost:7007');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on connection failure and resolves when it succeeds', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(new Response(null, { status: 200 }) as Response);
    await expect(
      waitForRhdhReady('http://localhost:7007', 5000, 0),
    ).resolves.toBe('http://localhost:7007');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws after timeout when never ready', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      waitForRhdhReady('http://localhost:7007', 10, 0),
    ).rejects.toThrow('did not become ready');
  });
});

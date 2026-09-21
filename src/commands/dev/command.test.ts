import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

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
    const taskMock = Task as jest.Mocked<typeof Task>;
    taskMock.forCommand.mockRejectedValueOnce(new Error('command not found'));
    await expect(validateContainerTool('docker')).rejects.toThrow(
      'Unable to find docker on PATH',
    );
  });

  it('accepts a container tool that is on PATH', async () => {
    const taskMock = Task as jest.Mocked<typeof Task>;
    taskMock.forCommand.mockResolvedValueOnce(undefined);
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
      mockExecFile.mockRejectedValueOnce(err);
      await expect(
        status({ rhdhLocalDir: runtimeDir, containerTool: 'podman' }),
      ).rejects.toThrow(ExitCodeError);
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
    ).rejects.toThrow('rerun with --configure');
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

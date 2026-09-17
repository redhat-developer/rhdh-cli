import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

jest.mock('../../lib/paths', () => ({
  paths: {
    resolveTarget: (...segments: string[]) =>
      path.join((global as any).__pluginDevTestDir ?? os.tmpdir(), ...segments),
  },
}));

import {
  actionsToRun,
  composeArgs,
  composeStatusArgs,
  formatRuntimeStatus,
  parseComposeStatus,
  resolveRuntimeDir,
  stagePlugin,
  validateContainerTool,
  validateProjectFiles,
  validateRuntime,
  ensureGeneratedConfigIncluded,
  updateGeneratedConfig,
} from './command';

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
    expect(composeArgs('logs', false, false, true)).toContain(
      'install-dynamic-plugins',
    );
    expect(composeArgs('logs', false, true, true)).toEqual([
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

  it('rejects unknown actions and container tools', () => {
    expect(() => composeArgs('remove-volumes')).toThrow(
      'Unknown plugin dev action',
    );
    expect(() => validateContainerTool('buildah')).toThrow('Allowed values');
  });

  it('runs non-destructive cleanup after stop when requested', () => {
    expect(actionsToRun('stop', true)).toEqual(['stop', 'clean']);
    expect(actionsToRun('update', false)).toEqual([
      'install-dynamic-plugins',
      'stop-rhdh',
      'start-rhdh',
    ]);
    expect(() => actionsToRun('start', true)).toThrow('only supported');
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
      'rhdh-cli.generated.yaml',
    );
    await fs.remove(directory);
  });

  it('always refreshes a staged local plugin', async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'plugin-dev-test-'),
    );
    const config = path.join(
      directory,
      'configs/dynamic-plugins/rhdh-cli.generated.yaml',
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

  it('copies staged plugin without following symlinks', async () => {
    const srcDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-dev-src-'));
    const runtimeDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'plugin-dev-runtime-'),
    );
    (global as any).__pluginDevTestDir = srcDir;
    try {
      // Simulate a dist-dynamic layout with a .bin symlink
      await fs.writeJson(path.join(srcDir, 'package.json'), {
        name: '@internal/my-plugin',
        version: '0.1.0',
        backstage: { role: 'backend-plugin' },
      });
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
    } finally {
      delete (global as any).__pluginDevTestDir;
      await fs.remove(srcDir);
      await fs.remove(runtimeDir);
    }
  });
});

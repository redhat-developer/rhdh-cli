/*
 * Copyright (c) Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0.
 */

jest.mock(
  '@backstage/cli-module-build/dist/commands/package/bundle/command.cjs.js',
  () => ({
    bundleCommand: jest.fn().mockResolvedValue(undefined),
  }),
);
jest.mock('../../lib/paths', () => ({
  paths: {
    targetDir: '/tmp/test-plugin',
    targetRoot: '/tmp/test-plugin',
    resolveTarget: (part: string) => `/tmp/test-plugin/${part}`,
  },
}));
jest.mock('../../lib/schema/collect', () => ({ getConfigSchema: jest.fn() }));
jest.mock('../../lib/tasks', () => ({ Task: { log: jest.fn() } }));
jest.mock('./frontend', () => ({
  frontend: jest.fn().mockResolvedValue('/tmp/test-plugin/dist-dynamic'),
}));
jest.mock('./check-heavy-deps', () => ({
  checkHeavyDependencies: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./dev', () => ({
  applyDevOptions: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('fs-extra', () => ({
  ...jest.requireActual('fs-extra'),
  readJson: jest.fn(),
  readJSON: jest.fn().mockResolvedValue({ backstage: {} }),
  existsSync: jest.fn().mockReturnValue(false),
  ensureDir: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
  writeJson: jest.fn().mockResolvedValue(undefined),
}));

import { bundleCommand } from '@backstage/cli-module-build/dist/commands/package/bundle/command.cjs.js';
import fs from 'fs-extra';

import { getConfigSchema } from '../../lib/schema/collect';
import { command } from './command';
import { frontend } from './frontend';

const target = '/tmp/test-plugin/dist-dynamic/dist';
const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: { example: { type: 'string' } },
} as const;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getConfigSchema).mockResolvedValue(schema);
});

test.each(['backend-plugin', 'backend-plugin-module'])(
  'uses upstream bundler for %s and removes a stale legacy schema',
  async role => {
    jest.mocked(fs.readJson).mockResolvedValue({
      name: '@internal/example',
      version: '1.0.0',
      backstage: { role },
    });

    await command({});

    expect(bundleCommand).toHaveBeenCalledWith({
      clean: false,
      build: true,
      install: true,
      verbose: false,
      outputName: 'dist-dynamic',
      outputDestination: undefined,
      prePackedDir: undefined,
    });
    expect(frontend).not.toHaveBeenCalled();
    expect(fs.remove).toHaveBeenCalledTimes(1);
    expect(fs.remove).toHaveBeenCalledWith(`${target}/configSchema.json`);
    expect(fs.writeJson).toHaveBeenCalledTimes(1);
    expect(fs.writeJson).toHaveBeenCalledWith(
      '/tmp/test-plugin/dist-dynamic/package.json',
      expect.objectContaining({ name: '@internal/example-dynamic' }),
      { spaces: 2 },
    );
    expect(getConfigSchema).not.toHaveBeenCalled();
  },
);

test('disables incompatible Yarn settings during backend bundling and restores them', async () => {
  jest.mocked(fs.readJson).mockResolvedValue({
    name: '@internal/example',
    version: '1.0.0',
    backstage: { role: 'backend-plugin' },
  });
  const previousColors = process.env.YARN_ENABLE_COLORS;
  const previousHardenedMode = process.env.YARN_ENABLE_HARDENED_MODE;
  process.env.YARN_ENABLE_COLORS = 'true';
  process.env.YARN_ENABLE_HARDENED_MODE = '1';

  try {
    jest.mocked(bundleCommand).mockImplementationOnce(async () => {
      expect(process.env.YARN_ENABLE_COLORS).toBe('0');
      expect(process.env.YARN_ENABLE_HARDENED_MODE).toBe('0');
    });
    await command({});
    expect(process.env.YARN_ENABLE_COLORS).toBe('true');
    expect(process.env.YARN_ENABLE_HARDENED_MODE).toBe('1');

    jest.mocked(bundleCommand).mockImplementationOnce(async () => {
      expect(process.env.YARN_ENABLE_COLORS).toBe('0');
      expect(process.env.YARN_ENABLE_HARDENED_MODE).toBe('0');
      throw new Error('bundle failed');
    });
    await expect(command({})).rejects.toThrow('bundle failed');
    expect(process.env.YARN_ENABLE_COLORS).toBe('true');
    expect(process.env.YARN_ENABLE_HARDENED_MODE).toBe('1');
  } finally {
    if (previousColors === undefined) {
      delete process.env.YARN_ENABLE_COLORS;
    } else {
      process.env.YARN_ENABLE_COLORS = previousColors;
    }
    if (previousHardenedMode === undefined) {
      delete process.env.YARN_ENABLE_HARDENED_MODE;
    } else {
      process.env.YARN_ENABLE_HARDENED_MODE = previousHardenedMode;
    }
  }
});

test.each(['frontend-plugin', 'frontend-plugin-module'])(
  'exports only the modern schema for %s',
  async role => {
    jest.mocked(fs.readJson).mockResolvedValue({
      name: '@internal/example',
      version: '1.0.0',
      backstage: { role },
    });

    await command({});

    expect(frontend).toHaveBeenCalledTimes(1);
    expect(bundleCommand).not.toHaveBeenCalled();
    expect(fs.remove).not.toHaveBeenCalled();
    expect(fs.writeJson).toHaveBeenCalledTimes(1);
    expect(fs.writeJson).toHaveBeenCalledWith(
      `${target}/.config-schema.json`,
      schema,
      { encoding: 'utf8', spaces: 2 },
    );
  },
);

test('rejects a backend plugin without a version before invoking the bundler', async () => {
  jest.mocked(fs.readJson).mockResolvedValue({
    name: '@internal/example',
    backstage: { role: 'backend-plugin' },
  });

  await expect(command({})).rejects.toThrow('missing a');

  expect(bundleCommand).not.toHaveBeenCalled();
});

test('checks the configured output destination', async () => {
  jest.mocked(fs.readJson).mockResolvedValue({
    name: '@internal/example',
    version: '1.0.0',
    backstage: { role: 'backend-plugin' },
  });

  await command({ outputDestination: '/tmp/exported' });

  expect(fs.remove).toHaveBeenCalledWith(
    '/tmp/exported/dist-dynamic/dist/configSchema.json',
  );
});

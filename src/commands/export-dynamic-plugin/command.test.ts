/*
 * Copyright (c) Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0.
 */

jest.mock('../../lib/paths', () => ({
  paths: {
    targetRoot: '/tmp/test-plugin',
    resolveTarget: (part: string) => `/tmp/test-plugin/${part}`,
  },
}));
jest.mock('../../lib/schema/collect', () => ({ getConfigSchema: jest.fn() }));
jest.mock('../../lib/tasks', () => ({ Task: { log: jest.fn() } }));
jest.mock('./backend', () => ({
  backend: jest.fn().mockResolvedValue('/tmp/test-plugin/dist-dynamic'),
}));
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

import fs from 'fs-extra';

import { getConfigSchema } from '../../lib/schema/collect';
import { backend } from './backend';
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
  'exports only the modern schema for %s and removes a stale legacy copy',
  async role => {
    jest.mocked(fs.readJson).mockResolvedValue({
      name: '@internal/example',
      backstage: { role },
    });

    await command({});

    expect(backend).toHaveBeenCalledTimes(1);
    expect(frontend).not.toHaveBeenCalled();
    expect(fs.remove).toHaveBeenCalledTimes(1);
    expect(fs.remove).toHaveBeenCalledWith(`${target}/configSchema.json`);
    expect(fs.writeJson).toHaveBeenCalledTimes(1);
    expect(fs.writeJson).toHaveBeenCalledWith(
      `${target}/.config-schema.json`,
      schema,
      { encoding: 'utf8', spaces: 2 },
    );
    expect(jest.mocked(fs.remove).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(fs.writeJson).mock.invocationCallOrder[0],
    );
  },
);

test.each(['frontend-plugin', 'frontend-plugin-module'])(
  'exports only the modern schema for %s',
  async role => {
    jest.mocked(fs.readJson).mockResolvedValue({
      name: '@internal/example',
      backstage: { role },
    });

    await command({});

    expect(frontend).toHaveBeenCalledTimes(1);
    expect(backend).not.toHaveBeenCalled();
    expect(fs.remove).not.toHaveBeenCalled();
    expect(fs.writeJson).toHaveBeenCalledTimes(1);
    expect(fs.writeJson).toHaveBeenCalledWith(
      `${target}/.config-schema.json`,
      schema,
      { encoding: 'utf8', spaces: 2 },
    );
  },
);

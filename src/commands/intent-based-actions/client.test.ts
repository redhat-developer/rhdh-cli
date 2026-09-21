import { EventEmitter } from 'node:events';
import { execFileSync, spawn } from 'node:child_process';
import { CliAuth } from '@backstage/cli-node';
import {
  execAction,
  execActionJson,
  execPassthrough,
  triggerTechDocsBuild,
} from './client';

jest.mock('node:child_process');
jest.mock('@backstage/cli-node');

const mockExecFileSync = execFileSync as jest.MockedFunction<
  typeof execFileSync
>;
const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
const mockCliAuthCreate = CliAuth.create as jest.MockedFunction<
  typeof CliAuth.create
>;

function mockExecFileSyncReturning(output: string) {
  mockExecFileSync.mockReturnValue(output as never);
}

function mockExecFileSyncThrowing(stderr: string) {
  mockExecFileSync.mockImplementation(() => {
    const error = new Error('Command failed') as Error & { stderr: Buffer };
    error.stderr = Buffer.from(stderr);
    throw error;
  });
}

describe('execAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the Backstage CLI stdout', async () => {
    mockExecFileSyncReturning('{"ok":true}');

    const result = await execAction('catalog:query-catalog-entities', {
      instance: 'default',
    });

    expect(result).toBe('{"ok":true}');
  });

  it('builds the command with the action id and unescaped simple flags', async () => {
    mockExecFileSyncReturning('{}');

    await execAction('catalog:query-catalog-entities', {
      instance: 'default',
      limit: 5,
    });

    const [command, args] = mockExecFileSync.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(args).toEqual(
      expect.arrayContaining([
        'actions',
        'execute',
        'catalog:query-catalog-entities',
        '--instance',
        'default',
        '--limit',
        '5',
      ]),
    );
  });

  it('passes flag values containing special characters as literal arguments', async () => {
    mockExecFileSyncReturning('{}');

    await execAction('catalog:query-catalog-entities', {
      query: '{"kind":"Component"}',
    });

    const [, args] = mockExecFileSync.mock.calls[0];
    expect(args).toEqual(
      expect.arrayContaining(['--query', '{"kind":"Component"}']),
    );
  });

  it('passes action ids and flag names as literal arguments', async () => {
    mockExecFileSyncReturning('{}');

    await execAction('actions:foo;echo pwned', {
      'bad;echo pwned': "it's a test",
    });

    const [, args] = mockExecFileSync.mock.calls[0];
    expect(args).toEqual(
      expect.arrayContaining([
        'actions:foo;echo pwned',
        '--bad;echo pwned',
        "it's a test",
      ]),
    );
  });

  it('adds boolean-true flags with no value', async () => {
    mockExecFileSyncReturning('{}');

    await execAction('actions:list', { verbose: true });

    const [, args] = mockExecFileSync.mock.calls[0];
    expect(args).toEqual(expect.arrayContaining(['--verbose']));
    expect(args).not.toEqual(expect.arrayContaining(['--verbose', 'true']));
  });

  it('omits flags that are false or undefined', async () => {
    mockExecFileSyncReturning('{}');

    await execAction('actions:list', { verbose: false, instance: undefined });

    const [, args] = mockExecFileSync.mock.calls[0];
    expect(args).not.toEqual(expect.arrayContaining(['--verbose']));
    expect(args).not.toEqual(expect.arrayContaining(['--instance']));
  });

  it('throws with the "Error:" line from stderr when the command fails', () => {
    mockExecFileSyncThrowing('some noise\nError: Entity not found\nmore noise');

    expect(() =>
      execAction('catalog:get-catalog-entity', { name: 'missing' }),
    ).toThrow('Entity not found');
  });

  it('falls back to the last stderr line when no "Error:" line is present', () => {
    mockExecFileSyncThrowing('first line\nlast line');

    expect(() =>
      execAction('catalog:get-catalog-entity', { name: 'missing' }),
    ).toThrow('last line');
  });

  it('rebrands "backstage-cli" as "rhdh-cli" in the thrown error message', () => {
    mockExecFileSyncThrowing('Error: run backstage-cli auth login first');

    expect(() =>
      execAction('catalog:get-catalog-entity', { name: 'missing' }),
    ).toThrow('run rhdh-cli auth login first');
  });

  it('throws a generic message when the command fails without stderr content', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('Command failed');
    });

    expect(() =>
      execAction('catalog:get-catalog-entity', { name: 'missing' }),
    ).toThrow('rhdh-cli command failed');
  });
});

describe('execActionJson', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses valid JSON output', async () => {
    mockExecFileSyncReturning('{"kind":"Component"}');

    const result = await execActionJson('catalog:get-catalog-entity', {
      name: 'x',
    });

    expect(result).toEqual({ kind: 'Component' });
  });

  it('returns the raw string when the output is not valid JSON', async () => {
    mockExecFileSyncReturning('not json');

    const result = await execActionJson('catalog:get-catalog-entity', {
      name: 'x',
    });

    expect(result).toBe('not json');
  });
});

describe('triggerTechDocsBuild', () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock;
    mockCliAuthCreate.mockResolvedValue({
      getAccessToken: jest.fn().mockResolvedValue('test-token'),
      getBaseUrl: jest.fn().mockReturnValue('https://rhdh.example.com'),
    } as unknown as CliAuth);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('waits for a successful authenticated TechDocs sync response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue('build logs'),
    });

    const result = await triggerTechDocsBuild(
      {
        namespace: 'default',
        kind: 'component',
        name: 'my service',
      },
      'local',
    );

    expect(mockCliAuthCreate).toHaveBeenCalledWith({ instanceName: 'local' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://rhdh.example.com/api/techdocs/sync/default/component/my%20service',
      {
        headers: { Authorization: 'Bearer test-token' },
      },
    );
    expect(result).toBe('build logs');
  });

  it('throws when the TechDocs sync endpoint returns a non-success status', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: jest.fn().mockResolvedValue('build failed'),
    });

    await expect(
      triggerTechDocsBuild({
        namespace: 'default',
        kind: 'component',
        name: 'my-service',
      }),
    ).rejects.toThrow(
      'TechDocs build failed with 500 Internal Server Error: build failed',
    );
  });
});

describe('execPassthrough', () => {
  let exitSpy: jest.SpyInstance;
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  function createFakeChild() {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    return child;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    stderrSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it.each([
    {
      description: 'an unsupported command',
      args: ['unsupported'],
      expectedMessage: 'Unsupported pass-through command: unsupported',
    },
    {
      description: 'a missing command',
      args: [],
      expectedMessage: 'Unsupported pass-through command: undefined',
    },
  ])(
    'rejects $description without spawning a child process',
    ({ args, expectedMessage }) => {
      expect(() => execPassthrough(args)).toThrow(new Error(expectedMessage));
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    },
  );

  it('spawns the resolved binary with the given passthrough args', () => {
    const child = createFakeChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    execPassthrough(['auth', 'login', '--backend-url', 'https://example.com']);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [command, args] = mockSpawn.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(args[0]).toContain('@backstage/cli-module-auth');
    expect(args).toEqual(
      expect.arrayContaining([
        'auth',
        'login',
        '--backend-url',
        'https://example.com',
      ]),
    );
  });

  it('uses the dedicated actions CLI module to avoid project module discovery', () => {
    const child = createFakeChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    execPassthrough(['actions', 'sources', 'list']);

    const [command, args] = mockSpawn.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(args[0]).toContain('@backstage/cli-module-actions');
    expect(args.slice(1)).toEqual(['actions', 'sources', 'list']);
  });

  it('rebrands "backstage-cli" as "rhdh-cli" in streamed stdout and exits with the child code', () => {
    const child = createFakeChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    execPassthrough(['auth', 'login']);
    child.stdout.emit(
      'data',
      Buffer.from('Run backstage-cli auth login to continue\n'),
    );
    child.emit('close', 0);

    const written = stdoutSpy.mock.calls.map(call => call[0]).join('');
    expect(written).toContain('Run rhdh-cli auth login to continue');
    expect(written).not.toContain('backstage-cli');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('rebrands a CLI module name split across output chunks', () => {
    const child = createFakeChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    execPassthrough(['actions', 'sources', 'list']);
    child.stdout.emit('data', Buffer.from('@backstage/cli-module-'));
    child.stdout.emit('data', Buffer.from('actions v0.1.3\n'));
    child.emit('close', 0);

    const written = stdoutSpy.mock.calls.map(call => call[0]).join('');
    expect(written).toContain('rhdh-cli v0.1.3');
    expect(written).not.toContain('@backstage/cli-module-actions');
  });

  it('exits with code 1 when the child process closes with no exit code', () => {
    const child = createFakeChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    execPassthrough(['auth', 'login']);
    child.emit('close', null);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('reports a launch failure and exits 1 when spawn errors', () => {
    const child = createFakeChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    execPassthrough(['auth', 'login']);
    child.emit('error', new Error('ENOENT'));

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to launch CLI module: ENOENT'),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

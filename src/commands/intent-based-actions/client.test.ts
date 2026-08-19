import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { execAction, execActionJson, execPassthrough } from './client';

jest.mock('node:child_process');

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

/**
 * The real execAction shells out to a resolved `backstage-cli` binary and
 * redirects stdout/stderr to temp files. Since execSync itself is mocked,
 * these helpers simulate what the real process would have written to those
 * files, using the actual filesystem (only child_process is mocked here).
 */
function mockExecSyncWritingFiles(
  handler: (outFile: string, errFile: string) => void,
) {
  mockExecSync.mockImplementation((cmd: unknown) => {
    const match = /> (\S+) 2>(\S+)$/.exec(String(cmd));
    if (!match) throw new Error(`Unexpected command shape: ${String(cmd)}`);
    const [, outFile, errFile] = match;
    handler(outFile, errFile);
    return Buffer.from('');
  });
}

describe('execAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves with the contents written to the redirected stdout file', async () => {
    mockExecSyncWritingFiles(outFile => {
      writeFileSync(outFile, '{"ok":true}');
    });

    const result = await execAction('catalog:query-catalog-entities', {
      instance: 'default',
    });

    expect(result).toBe('{"ok":true}');
  });

  it('builds the command with the action id and unescaped simple flags', async () => {
    mockExecSyncWritingFiles(outFile => writeFileSync(outFile, '{}'));

    await execAction('catalog:query-catalog-entities', {
      instance: 'default',
      limit: 5,
    });

    const cmd = String(mockExecSync.mock.calls[0][0]);
    expect(cmd).toContain('actions execute catalog:query-catalog-entities');
    expect(cmd).toContain('--instance default');
    expect(cmd).toContain('--limit 5');
  });

  it('quotes and escapes flag values containing special characters', async () => {
    mockExecSyncWritingFiles(outFile => writeFileSync(outFile, '{}'));

    await execAction('catalog:query-catalog-entities', {
      query: '{"kind":"Component"}',
    });

    const cmd = String(mockExecSync.mock.calls[0][0]);
    expect(cmd).toContain(`--query '{"kind":"Component"}'`);
  });

  it('escapes single quotes within flag values', async () => {
    mockExecSyncWritingFiles(outFile => writeFileSync(outFile, '{}'));

    await execAction('catalog:validate-entity', { entity: "it's a test" });

    const cmd = String(mockExecSync.mock.calls[0][0]);
    expect(cmd).toContain(`'it'\\''s a test'`);
  });

  it('adds boolean-true flags with no value', async () => {
    mockExecSyncWritingFiles(outFile => writeFileSync(outFile, '{}'));

    await execAction('actions:list', { verbose: true });

    const cmd = String(mockExecSync.mock.calls[0][0]);
    expect(cmd).toMatch(/--verbose(\s|$)/);
    expect(cmd).not.toContain('--verbose true');
  });

  it('omits flags that are false or undefined', async () => {
    mockExecSyncWritingFiles(outFile => writeFileSync(outFile, '{}'));

    await execAction('actions:list', { verbose: false, instance: undefined });

    const cmd = String(mockExecSync.mock.calls[0][0]);
    expect(cmd).not.toContain('--verbose');
    expect(cmd).not.toContain('--instance');
  });

  it('rejects with the "Error:" line from stderr when the command fails', async () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const match = /> (\S+) 2>(\S+)$/.exec(String(cmd));
      const [, , errFile] = match!;
      writeFileSync(errFile, 'some noise\nError: Entity not found\nmore noise');
      throw new Error('Command failed');
    });

    await expect(
      execAction('catalog:get-catalog-entity', { name: 'missing' }),
    ).rejects.toThrow('Entity not found');
  });

  it('falls back to the last stderr line when no "Error:" line is present', async () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const match = /> (\S+) 2>(\S+)$/.exec(String(cmd));
      const [, , errFile] = match!;
      writeFileSync(errFile, 'first line\nlast line');
      throw new Error('Command failed');
    });

    await expect(
      execAction('catalog:get-catalog-entity', { name: 'missing' }),
    ).rejects.toThrow('last line');
  });

  it('rebrands "backstage-cli" as "rhdh-cli" in the thrown error message', async () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const match = /> (\S+) 2>(\S+)$/.exec(String(cmd));
      const [, , errFile] = match!;
      writeFileSync(errFile, 'Error: run backstage-cli auth login first');
      throw new Error('Command failed');
    });

    await expect(
      execAction('catalog:get-catalog-entity', { name: 'missing' }),
    ).rejects.toThrow('run rhdh-cli auth login first');
  });

  it('rejects with a generic message when the command fails without stderr content', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('Command failed');
    });

    await expect(
      execAction('catalog:get-catalog-entity', { name: 'missing' }),
    ).rejects.toThrow('rhdh-cli command failed');
  });
});

describe('execActionJson', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses valid JSON output', async () => {
    mockExecSyncWritingFiles(outFile =>
      writeFileSync(outFile, '{"kind":"Component"}'),
    );

    const result = await execActionJson('catalog:get-catalog-entity', {
      name: 'x',
    });

    expect(result).toEqual({ kind: 'Component' });
  });

  it('returns the raw string when the output is not valid JSON', async () => {
    mockExecSyncWritingFiles(outFile => writeFileSync(outFile, 'not json'));

    const result = await execActionJson('catalog:get-catalog-entity', {
      name: 'x',
    });

    expect(result).toBe('not json');
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

  it('spawns the resolved binary with the given passthrough args', () => {
    const child = createFakeChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    execPassthrough(['auth', 'login', '--backend-url', 'https://example.com']);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [command, args] = mockSpawn.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(args).toEqual(
      expect.arrayContaining([
        'auth',
        'login',
        '--backend-url',
        'https://example.com',
      ]),
    );
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
      expect.stringContaining('Failed to launch backstage-cli: ENOENT'),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

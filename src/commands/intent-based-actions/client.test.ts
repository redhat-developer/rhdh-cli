import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { execPassthrough } from './client';

jest.mock('node:child_process');

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

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

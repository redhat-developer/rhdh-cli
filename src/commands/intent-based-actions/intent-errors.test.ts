import { formatError, handleCommandError, CliError } from './intent-errors';

describe('formatError', () => {
  it('returns pretty-printed JSON in json mode', () => {
    const err: CliError = { error: 'boom', reason: 'it broke' };
    expect(formatError(err, 'json')).toBe(`${JSON.stringify(err, null, 2)}\n`);
  });

  it('includes the suggestion field in json mode when present', () => {
    const err: CliError = {
      error: 'boom',
      reason: 'it broke',
      suggestion: 'try again',
    };
    const parsed = JSON.parse(formatError(err, 'json'));
    expect(parsed.suggestion).toBe('try again');
  });

  it('renders the error message in human mode', () => {
    const err: CliError = { error: 'boom', reason: 'boom' };
    const output = formatError(err, 'human');
    expect(output).toContain('Error:');
    expect(output).toContain('boom');
  });

  it('renders the reason on its own line when it differs from the error', () => {
    const err: CliError = { error: 'boom', reason: 'a more detailed reason' };
    const output = formatError(err, 'human');
    expect(output).toContain('boom');
    expect(output).toContain('a more detailed reason');
  });

  it('does not duplicate the reason line when it matches the error', () => {
    const err: CliError = { error: 'same message', reason: 'same message' };
    const output = formatError(err, 'human');
    const occurrences = output.split('same message').length - 1;
    expect(occurrences).toBe(1);
  });

  it('normalizes a leading "Error:" prefix before comparing error and reason', () => {
    const err: CliError = {
      error: 'Error: same message',
      reason: 'same message',
    };
    const output = formatError(err, 'human');
    const occurrences = output.split('same message').length - 1;
    expect(occurrences).toBe(1);
  });

  it('includes the suggestion under a "Try:" line when present', () => {
    const err: CliError = {
      error: 'boom',
      reason: 'boom',
      suggestion: 'rhdh-cli catalog list --kind Component',
    };
    const output = formatError(err, 'human');
    expect(output).toContain('Try:');
    expect(output).toContain('rhdh-cli catalog list --kind Component');
  });

  it('omits the "Try:" line when no suggestion is present', () => {
    const err: CliError = { error: 'boom', reason: 'boom' };
    const output = formatError(err, 'human');
    expect(output).not.toContain('Try:');
  });
});

describe('handleCommandError', () => {
  let exitSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    stderrSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  function writtenError(): CliError {
    const written = stderrSpy.mock.calls[0][0] as string;
    return JSON.parse(written) as CliError;
  }

  it('always exits with code 1', () => {
    handleCommandError(new Error('boom'), 'json');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('writes the error to stderr', () => {
    handleCommandError(new Error('boom'), 'json');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it('includes the provided suggestion', () => {
    handleCommandError(new Error('boom'), 'json', {
      suggestion: 'rhdh-cli catalog list',
    });
    expect(writtenError().suggestion).toBe('rhdh-cli catalog list');
  });

  it('omits the suggestion field when none is provided', () => {
    handleCommandError(new Error('boom'), 'json');
    expect(writtenError().suggestion).toBeUndefined();
  });

  it('maps a 401/Unauthorized error to an authentication reason', () => {
    handleCommandError(new Error('Request failed with 401'), 'json');
    expect(writtenError().reason).toMatch(/rhdh-cli auth login/);
  });

  it('maps an Unauthorized error to an authentication reason', () => {
    handleCommandError(new Error('Unauthorized'), 'json');
    expect(writtenError().reason).toMatch(/rhdh-cli auth login/);
  });

  it('maps a 404/Not Found error to a not-found reason', () => {
    handleCommandError(new Error('404'), 'json');
    expect(writtenError().reason).toMatch(/was not found/);
  });

  it('maps an ECONNREFUSED error to a connectivity reason', () => {
    handleCommandError(new Error('connect ECONNREFUSED 127.0.0.1'), 'json');
    expect(writtenError().reason).toMatch(/Could not connect/);
  });

  it('maps a "fetch failed" error to a connectivity reason', () => {
    handleCommandError(new Error('fetch failed'), 'json');
    expect(writtenError().reason).toMatch(/Could not connect/);
  });

  it('maps a "No authenticated instances" error to a configuration reason', () => {
    handleCommandError(new Error('No authenticated instances'), 'json');
    expect(writtenError().reason).toMatch(/No Backstage instance configured/);
  });

  it('checks the message of the full error cause chain, not just the top-level message', () => {
    const outer = new Error('outer failure', {
      cause: new Error('inner 404 Not Found'),
    });
    handleCommandError(outer, 'json');
    const result = writtenError();
    expect(result.error).toBe('outer failure');
    expect(result.reason).toMatch(/was not found/);
  });

  it('falls back to the error message as the reason when no pattern matches', () => {
    handleCommandError(new Error('something unexpected happened'), 'json');
    const result = writtenError();
    expect(result.error).toBe('something unexpected happened');
    expect(result.reason).toBe('something unexpected happened');
  });

  it('extracts the "Error:" line from a stderr-bearing error over the raw message', () => {
    const error = Object.assign(new Error('backstage-cli command failed'), {
      stderr: 'some noise\nError: Something went wrong\nmore noise',
    });
    handleCommandError(error, 'json');
    const result = writtenError();
    expect(result.error).toBe('Something went wrong');
    expect(result.reason).toBe('Something went wrong');
  });

  it('falls back to the first non-empty stderr line when no "Error:" line is present', () => {
    const error = Object.assign(new Error('backstage-cli command failed'), {
      stderr: 'first line\nsecond line',
    });
    handleCommandError(error, 'json');
    expect(writtenError().error).toBe('first line');
  });

  it('treats a non-Error thrown value as an unknown error', () => {
    handleCommandError('just a string', 'json');
    const result = writtenError();
    expect(result.error).toBe('just a string');
    expect(result.reason).toBe('Unknown error');
  });
});

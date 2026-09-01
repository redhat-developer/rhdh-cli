import { execAction, execActionJson } from './client';
import { handleCommandError } from './intent-errors';
import { runEntityListAction, runRawAction, runSearchAction } from './helpers';

jest.mock('./client');
jest.mock('./intent-errors');

const mockExecAction = execAction as jest.MockedFunction<typeof execAction>;
const mockExecActionJson = execActionJson as jest.MockedFunction<
  typeof execActionJson
>;
const mockHandleCommandError = handleCommandError as jest.MockedFunction<
  typeof handleCommandError
>;

describe('runEntityListAction', () => {
  let writeSpy: jest.SpyInstance;

  beforeEach(() => {
    writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('writes the raw action output directly in json mode', async () => {
    mockExecAction.mockResolvedValue('{"items":[]}');

    await runEntityListAction(
      'catalog:query-catalog-entities',
      { instance: 'default' },
      'json',
    );

    expect(mockExecAction).toHaveBeenCalledWith(
      'catalog:query-catalog-entities',
      { instance: 'default' },
    );
    expect(mockExecActionJson).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledWith('{"items":[]}');
  });

  it('extracts entities and renders a table in human mode', async () => {
    mockExecActionJson.mockResolvedValue({
      items: [{ kind: 'Component', metadata: { name: 'my-service' } }],
    });

    await runEntityListAction(
      'catalog:query-catalog-entities',
      { instance: 'default' },
      'human',
    );

    expect(mockExecActionJson).toHaveBeenCalledWith(
      'catalog:query-catalog-entities',
      { instance: 'default' },
    );
    expect(mockExecAction).not.toHaveBeenCalled();
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain('my-service');
    expect(output).toContain('Component');
  });

  it('routes errors from execAction to handleCommandError with the given suggestion', async () => {
    const error = new Error('boom');
    mockExecAction.mockRejectedValue(error);

    await runEntityListAction(
      'catalog:query-catalog-entities',
      {},
      'json',
      'try this',
    );

    expect(mockHandleCommandError).toHaveBeenCalledWith(error, 'json', {
      suggestion: 'try this',
    });
  });

  it('calls handleCommandError without a suggestion when none is given', async () => {
    const error = new Error('boom');
    mockExecActionJson.mockRejectedValue(error);

    await runEntityListAction('catalog:query-catalog-entities', {}, 'human');

    expect(mockHandleCommandError).toHaveBeenCalledWith(
      error,
      'human',
      undefined,
    );
  });
});

describe('runRawAction', () => {
  let writeSpy: jest.SpyInstance;

  beforeEach(() => {
    writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('writes the raw string directly in json mode', async () => {
    mockExecAction.mockResolvedValue('{"foo":"bar"}');

    await runRawAction('catalog:get-catalog-entity', { name: 'x' }, 'json');

    expect(writeSpy).toHaveBeenCalledWith('{"foo":"bar"}');
  });

  it('pretty-prints the parsed JSON in human mode', async () => {
    mockExecAction.mockResolvedValue('{"foo":"bar"}');

    await runRawAction('catalog:get-catalog-entity', { name: 'x' }, 'human');

    expect(writeSpy).toHaveBeenCalledWith(
      `${JSON.stringify({ foo: 'bar' }, null, 2)}\n`,
    );
  });

  it('routes execAction errors to handleCommandError', async () => {
    const error = new Error('boom');
    mockExecAction.mockRejectedValue(error);

    await runRawAction(
      'catalog:get-catalog-entity',
      {},
      'json',
      'suggestion here',
    );

    expect(mockHandleCommandError).toHaveBeenCalledWith(error, 'json', {
      suggestion: 'suggestion here',
    });
  });

  it('routes JSON parse failures in human mode to handleCommandError', async () => {
    mockExecAction.mockResolvedValue('not valid json');

    await runRawAction('catalog:get-catalog-entity', {}, 'human');

    expect(mockHandleCommandError).toHaveBeenCalledTimes(1);
    expect(mockHandleCommandError.mock.calls[0][1]).toBe('human');
  });
});

describe('runSearchAction', () => {
  let writeSpy: jest.SpyInstance;

  beforeEach(() => {
    writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    jest.clearAllMocks();
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('merges the term into the flags passed to the search:query action', async () => {
    mockExecAction.mockResolvedValue('{}');

    await runSearchAction('my service', { instance: 'default' }, 'json');

    expect(mockExecAction).toHaveBeenCalledWith('search:query', {
      term: 'my service',
      instance: 'default',
    });
  });

  it('writes the raw output directly in json mode', async () => {
    mockExecAction.mockResolvedValue('{"results":[]}');

    await runSearchAction('term', {}, 'json');

    expect(writeSpy).toHaveBeenCalledWith('{"results":[]}');
  });

  it('extracts result.results and renders snippets in human mode', async () => {
    mockExecActionJson.mockResolvedValue({
      results: [{ document: { title: 'Doc title', text: 'some text' } }],
    });

    await runSearchAction('term', {}, 'human');

    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain('Doc title');
    expect(output).toContain('some text');
  });

  it('treats a bare array result as the results list directly', async () => {
    mockExecActionJson.mockResolvedValue([
      { document: { title: 'Bare result' } },
    ]);

    await runSearchAction('term', {}, 'human');

    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain('Bare result');
  });

  it('routes errors to handleCommandError with the given suggestion', async () => {
    const error = new Error('boom');
    mockExecActionJson.mockRejectedValue(error);

    await runSearchAction('term', {}, 'human', 'rhdh-cli search "term"');

    expect(mockHandleCommandError).toHaveBeenCalledWith(error, 'human', {
      suggestion: 'rhdh-cli search "term"',
    });
  });
});

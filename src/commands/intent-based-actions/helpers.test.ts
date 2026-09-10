import { execAction, execActionJson } from './client';
import { handleCommandError } from './intent-errors';
import {
  runEntityListAction,
  runRawAction,
  runSearchAction,
  resolveEntityWithAmbiguityCheck,
} from './helpers';

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
    mockExecAction.mockReturnValue('{"items":[]}');

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
    mockExecActionJson.mockReturnValue({
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
    mockExecAction.mockImplementation(() => {
      throw error;
    });

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
    mockExecActionJson.mockImplementation(() => {
      throw error;
    });

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
    mockExecAction.mockReturnValue('{"foo":"bar"}');

    await runRawAction('catalog:get-catalog-entity', { name: 'x' }, 'json');

    expect(writeSpy).toHaveBeenCalledWith('{"foo":"bar"}');
  });

  it('pretty-prints the parsed JSON in human mode', async () => {
    mockExecAction.mockReturnValue('{"foo":"bar"}');

    await runRawAction('catalog:get-catalog-entity', { name: 'x' }, 'human');

    expect(writeSpy).toHaveBeenCalledWith(
      `${JSON.stringify({ foo: 'bar' }, null, 2)}\n`,
    );
  });

  it('routes execAction errors to handleCommandError', async () => {
    const error = new Error('boom');
    mockExecAction.mockImplementation(() => {
      throw error;
    });

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
    mockExecAction.mockReturnValue('not valid json');

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
    mockExecAction.mockReturnValue('{}');

    await runSearchAction('my service', { instance: 'default' }, 'json');

    expect(mockExecAction).toHaveBeenCalledWith('search:query', {
      term: 'my service',
      instance: 'default',
    });
  });

  it('writes the raw output directly in json mode', async () => {
    mockExecAction.mockReturnValue('{"results":[]}');

    await runSearchAction('term', {}, 'json');

    expect(writeSpy).toHaveBeenCalledWith('{"results":[]}');
  });

  it('extracts result.results and renders snippets in human mode', async () => {
    mockExecActionJson.mockReturnValue({
      results: [{ document: { title: 'Doc title', text: 'some text' } }],
    });

    await runSearchAction('term', {}, 'human');

    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain('Doc title');
    expect(output).toContain('some text');
  });

  it('treats a bare array result as the results list directly', async () => {
    mockExecActionJson.mockReturnValue([
      { document: { title: 'Bare result' } },
    ]);

    await runSearchAction('term', {}, 'human');

    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain('Bare result');
  });

  it('falls back to JSON output for a non-array search result', async () => {
    const result = { message: 'unexpected response shape' };
    mockExecActionJson.mockReturnValue(result);

    await runSearchAction('term', {}, 'human');

    expect(writeSpy).toHaveBeenCalledWith(
      `${JSON.stringify(result, null, 2)}\n`,
    );
    expect(mockHandleCommandError).not.toHaveBeenCalled();
  });

  it('routes errors to handleCommandError with the given suggestion', async () => {
    const error = new Error('boom');
    mockExecActionJson.mockImplementation(() => {
      throw error;
    });

    await runSearchAction('term', {}, 'human', 'rhdh-cli search "term"');

    expect(mockHandleCommandError).toHaveBeenCalledWith(error, 'human', {
      suggestion: 'rhdh-cli search "term"',
    });
  });
});

describe('resolveEntityWithAmbiguityCheck', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns directly when full reference is provided (kind and namespace)', async () => {
    const result = await resolveEntityWithAmbiguityCheck(
      'component:default/my-service',
    );

    expect(result).toEqual({
      kind: 'component',
      namespace: 'default',
      name: 'my-service',
      entityRef: 'component:default/my-service',
    });

    // Should not query the catalog
    expect(mockExecActionJson).not.toHaveBeenCalled();
  });

  it('returns directly when kind flag and namespace flag are provided', async () => {
    const result = await resolveEntityWithAmbiguityCheck('my-service', {
      kindFlag: 'component',
      namespaceFlag: 'production',
    });

    expect(result).toEqual({
      kind: 'component',
      namespace: 'production',
      name: 'my-service',
      entityRef: 'component:production/my-service',
    });

    // Should not query the catalog
    expect(mockExecActionJson).not.toHaveBeenCalled();
  });

  it('queries catalog when short name is provided and resolves single match', async () => {
    mockExecActionJson.mockReturnValue({
      items: [
        {
          kind: 'Component',
          metadata: { name: 'my-service', namespace: 'default' },
        },
      ],
    });

    const result = await resolveEntityWithAmbiguityCheck('my-service');

    expect(mockExecActionJson).toHaveBeenCalledWith(
      'catalog:query-catalog-entities',
      {
        query: JSON.stringify({ 'metadata.name': 'my-service' }),
        instance: undefined,
      },
    );

    expect(result).toEqual({
      kind: 'Component',
      namespace: 'default',
      name: 'my-service',
      entityRef: 'Component:default/my-service',
    });
  });

  it('queries catalog with kind filter when defaultKind is provided', async () => {
    mockExecActionJson.mockReturnValue({
      items: [
        {
          kind: 'Template',
          metadata: { name: 'my-template', namespace: 'default' },
        },
      ],
    });

    const result = await resolveEntityWithAmbiguityCheck('my-template', {
      defaultKind: 'template',
    });

    expect(mockExecActionJson).toHaveBeenCalledWith(
      'catalog:query-catalog-entities',
      {
        query: JSON.stringify({
          'metadata.name': 'my-template',
          kind: 'template',
        }),
        instance: undefined,
      },
    );

    expect(result).toEqual({
      kind: 'Template',
      namespace: 'default',
      name: 'my-template',
      entityRef: 'Template:default/my-template',
    });
  });

  it('returns directly when both kind and namespace flags are provided (full reference)', async () => {
    const result = await resolveEntityWithAmbiguityCheck('my-service', {
      kindFlag: 'component',
      namespaceFlag: 'production',
    });

    // Should NOT query catalog when we have full reference
    expect(mockExecActionJson).not.toHaveBeenCalled();

    expect(result).toEqual({
      kind: 'component',
      namespace: 'production',
      name: 'my-service',
      entityRef: 'component:production/my-service',
    });
  });

  it('throws error when no entities found', async () => {
    mockExecActionJson.mockReturnValue({ items: [] });

    await expect(
      resolveEntityWithAmbiguityCheck('nonexistent-service'),
    ).rejects.toThrow('Entity not found: nonexistent-service');
  });

  it('throws error when no entities found with kind filter', async () => {
    mockExecActionJson.mockReturnValue({ items: [] });

    await expect(
      resolveEntityWithAmbiguityCheck('nonexistent', {
        kindFlag: 'component',
      }),
    ).rejects.toThrow('Entity not found: component:*/nonexistent');
  });

  it('throws ambiguity error when multiple entities found', async () => {
    mockExecActionJson.mockReturnValue({
      items: [
        {
          kind: 'Component',
          metadata: { name: 'my-service', namespace: 'default' },
        },
        {
          kind: 'Component',
          metadata: { name: 'my-service', namespace: 'production' },
        },
        {
          kind: 'API',
          metadata: { name: 'my-service', namespace: 'default' },
        },
      ],
    });

    await expect(resolveEntityWithAmbiguityCheck('my-service')).rejects.toThrow(
      /Ambiguous entity reference.*Multiple entities named "my-service" found/,
    );
  });

  it('includes all matching entities in ambiguity error message', async () => {
    mockExecActionJson.mockReturnValue({
      items: [
        {
          kind: 'Component',
          metadata: { name: 'my-service', namespace: 'default' },
        },
        {
          kind: 'Component',
          metadata: { name: 'my-service', namespace: 'production' },
        },
      ],
    });

    await expect(resolveEntityWithAmbiguityCheck('my-service')).rejects.toThrow(
      /Component:default\/my-service[\s\S]*Component:production\/my-service[\s\S]*Use full reference to disambiguate/,
    );
  });

  it('returns directly when namespace/name format with kind flag (full reference)', async () => {
    const result = await resolveEntityWithAmbiguityCheck(
      'production/my-service',
      {
        kindFlag: 'component',
      },
    );

    // Should NOT query catalog when we have full reference (kind from flag + namespace from ref)
    expect(mockExecActionJson).not.toHaveBeenCalled();

    expect(result).toEqual({
      kind: 'component',
      namespace: 'production',
      name: 'my-service',
      entityRef: 'component:production/my-service',
    });
  });

  it('passes instance option through to catalog query', async () => {
    mockExecActionJson.mockReturnValue({
      items: [
        {
          kind: 'Component',
          metadata: { name: 'my-service', namespace: 'default' },
        },
      ],
    });

    await resolveEntityWithAmbiguityCheck('my-service', {
      instance: 'my-instance',
    });

    expect(mockExecActionJson).toHaveBeenCalledWith(
      'catalog:query-catalog-entities',
      {
        query: JSON.stringify({ 'metadata.name': 'my-service' }),
        instance: 'my-instance',
      },
    );
  });

  it('handles entities array directly (backward compatibility)', async () => {
    mockExecActionJson.mockReturnValue([
      {
        kind: 'Component',
        metadata: { name: 'my-service', namespace: 'default' },
      },
    ]);

    const result = await resolveEntityWithAmbiguityCheck('my-service');

    expect(result).toEqual({
      kind: 'Component',
      namespace: 'default',
      name: 'my-service',
      entityRef: 'Component:default/my-service',
    });
  });
});

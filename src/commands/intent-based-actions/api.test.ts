import { Command } from 'commander';
import { registerApiCommands } from './api';
import { execAction } from './client';
import {
  resolveEntityWithAmbiguityCheck,
  runEntityListAction,
} from './helpers';
import { handleCommandError } from './intent-errors';

jest.mock('./helpers');
jest.mock('./client');
jest.mock('./intent-errors');

const mockRunEntityListAction = runEntityListAction as jest.MockedFunction<
  typeof runEntityListAction
>;
const mockResolveEntityWithAmbiguityCheck =
  resolveEntityWithAmbiguityCheck as jest.MockedFunction<
    typeof resolveEntityWithAmbiguityCheck
  >;
const mockExecAction = execAction as jest.MockedFunction<typeof execAction>;
const mockHandleCommandError = handleCommandError as jest.MockedFunction<
  typeof handleCommandError
>;

async function parseApi(...args: string[]) {
  const program = new Command();
  registerApiCommands(program);
  await program.parseAsync(['node', 'test', 'api', ...args]);
}

describe('api', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists API entities and applies optional --type', async () => {
    await parseApi('list');
    expect(mockRunEntityListAction).toHaveBeenCalledWith(
      'catalog:query-catalog-entities',
      {
        query: JSON.stringify({ kind: 'API' }),
        instance: undefined,
        limit: undefined,
      },
      'human',
      'rhdh-cli api list',
    );

    jest.clearAllMocks();
    await parseApi('list', '--type', 'openapi');
    expect(mockRunEntityListAction).toHaveBeenCalledWith(
      'catalog:query-catalog-entities',
      {
        query: JSON.stringify({ kind: 'API', 'spec.type': 'openapi' }),
        instance: undefined,
        limit: undefined,
      },
      'human',
      'rhdh-cli api list',
    );
  });

  it('get-spec resolves the entity and writes definition or errors', async () => {
    mockResolveEntityWithAmbiguityCheck.mockResolvedValue({
      entityRef: 'api:default/petstore',
      kind: 'API',
      namespace: 'default',
      name: 'petstore',
    });
    mockExecAction.mockReturnValue(
      JSON.stringify({
        spec: { type: 'openapi', definition: 'openapi: 3.0.0' },
      }),
    );

    const writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    await parseApi('get-spec', 'petstore');
    expect(mockResolveEntityWithAmbiguityCheck).toHaveBeenCalledWith(
      'petstore',
      expect.objectContaining({ defaultKind: 'api' }),
    );
    expect(mockExecAction).toHaveBeenCalledWith('catalog:get-catalog-entity', {
      name: 'petstore',
      kind: 'API',
      namespace: 'default',
      instance: undefined,
    });
    expect(writeSpy).toHaveBeenCalledWith('openapi: 3.0.0\n');

    writeSpy.mockClear();
    await parseApi('get-spec', 'petstore', '--output', 'json');
    expect(JSON.parse(writeSpy.mock.calls[0][0] as string)).toEqual({
      name: 'petstore',
      type: 'openapi',
      definition: 'openapi: 3.0.0',
    });
    writeSpy.mockRestore();

    mockResolveEntityWithAmbiguityCheck.mockResolvedValue({
      entityRef: 'api:default/empty',
      kind: 'API',
      namespace: 'default',
      name: 'empty',
    });
    mockExecAction.mockReturnValue(
      JSON.stringify({ spec: { type: 'openapi' } }),
    );
    await parseApi('get-spec', 'empty');
    expect(mockHandleCommandError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'API "empty" has no spec.definition',
      }),
      'human',
      { suggestion: 'rhdh-cli api list' },
    );
  });
});

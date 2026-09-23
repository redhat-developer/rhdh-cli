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

function captureStdout() {
  return jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
}

describe('api list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('queries kind API', async () => {
    const program = new Command();
    registerApiCommands(program);

    await program.parseAsync(['node', 'test', 'api', 'list']);

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
  });

  it('includes optional --type in the query', async () => {
    const program = new Command();
    registerApiCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'api',
      'list',
      '--type',
      'openapi',
    ]);

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
});

describe('api get-spec', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves the entity and writes the human definition', async () => {
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
    const writeSpy = captureStdout();
    const program = new Command();
    registerApiCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'api',
      'get-spec',
      'petstore',
    ]);

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
    writeSpy.mockRestore();
  });

  it('writes structured json when --output json', async () => {
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
    const writeSpy = captureStdout();
    const program = new Command();
    registerApiCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'api',
      'get-spec',
      'petstore',
      '--output',
      'json',
    ]);

    const output = writeSpy.mock.calls[0][0] as string;
    expect(JSON.parse(output)).toEqual({
      name: 'petstore',
      type: 'openapi',
      definition: 'openapi: 3.0.0',
    });
    writeSpy.mockRestore();
  });

  it('calls handleCommandError when spec.definition is missing', async () => {
    mockResolveEntityWithAmbiguityCheck.mockResolvedValue({
      entityRef: 'api:default/empty',
      kind: 'API',
      namespace: 'default',
      name: 'empty',
    });
    mockExecAction.mockReturnValue(
      JSON.stringify({ spec: { type: 'openapi' } }),
    );
    const program = new Command();
    registerApiCommands(program);

    await program.parseAsync(['node', 'test', 'api', 'get-spec', 'empty']);

    expect(mockHandleCommandError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'API "empty" has no spec.definition',
      }),
      'human',
      { suggestion: 'rhdh-cli api list' },
    );
  });
});

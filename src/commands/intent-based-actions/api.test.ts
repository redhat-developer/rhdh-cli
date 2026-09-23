import { Command } from 'commander';
import { registerApiCommands } from './api';
import { execAction } from './client';
import { resolveEntityWithAmbiguityCheck } from './helpers';
import { handleCommandError } from './intent-errors';

jest.mock('./helpers');
jest.mock('./client');
jest.mock('./intent-errors');

const mockResolveEntityWithAmbiguityCheck =
  resolveEntityWithAmbiguityCheck as jest.MockedFunction<
    typeof resolveEntityWithAmbiguityCheck
  >;
const mockExecAction = execAction as jest.MockedFunction<typeof execAction>;
const mockHandleCommandError = handleCommandError as jest.MockedFunction<
  typeof handleCommandError
>;

describe('api get-spec validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('errors when the entity has no spec.definition', async () => {
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

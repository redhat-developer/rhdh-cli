import { Command } from 'commander';
import { runRawAction } from './helpers';
import { handleCommandError } from './intent-errors';
import { registerTemplateCommands } from './template';

jest.mock('./helpers');
jest.mock('./intent-errors');

const mockHandleCommandError = handleCommandError as jest.MockedFunction<
  typeof handleCommandError
>;
const mockRunRawAction = runRawAction as jest.MockedFunction<
  typeof runRawAction
>;

describe('template command validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHandleCommandError.mockImplementation(() => {
      throw new Error('COMMAND_EXIT');
    });
  });

  it('rejects dry-run without --template-file', async () => {
    const program = new Command();
    registerTemplateCommands(program);

    await expect(
      program.parseAsync(['node', 'test', 'template', 'dry-run']),
    ).rejects.toThrow('COMMAND_EXIT');

    expect(mockHandleCommandError).toHaveBeenCalledTimes(1);
    expect(mockHandleCommandError).toHaveBeenCalledWith(
      expect.objectContaining({ message: '--template-file is required' }),
      'human',
      {
        suggestion:
          'rhdh-cli template dry-run --template-file ./template.yaml --value name=my-app',
      },
    );
    expect(mockRunRawAction).not.toHaveBeenCalled();
  });
});

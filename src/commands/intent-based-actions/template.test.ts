import { Command } from 'commander';
import { handleCommandError } from './intent-errors';
import { registerTemplateCommands } from './template';

jest.mock('./helpers');
jest.mock('./intent-errors');

const mockHandleCommandError = handleCommandError as jest.MockedFunction<
  typeof handleCommandError
>;

describe('template command validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects dry-run without --template-file', async () => {
    const program = new Command();
    registerTemplateCommands(program);
    await program.parseAsync(['node', 'test', 'template', 'dry-run']);

    expect(mockHandleCommandError).toHaveBeenCalledWith(
      expect.objectContaining({ message: '--template-file is required' }),
      'human',
      {
        suggestion:
          'rhdh-cli template dry-run --template-file ./template.yaml --value name=my-app',
      },
    );
  });
});

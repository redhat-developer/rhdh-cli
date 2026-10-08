import { Command } from 'commander';
import { registerCatalogCommands } from './catalog';
import { runRawAction } from './helpers';
import { handleCommandError } from './intent-errors';

jest.mock('./helpers');
jest.mock('./intent-errors');

const mockHandleCommandError = handleCommandError as jest.MockedFunction<
  typeof handleCommandError
>;
const mockRunRawAction = runRawAction as jest.MockedFunction<
  typeof runRawAction
>;

async function parseCatalog(...args: string[]) {
  const program = new Command();
  registerCatalogCommands(program);
  await program.parseAsync(['node', 'test', 'catalog', ...args]);
}

describe('catalog command validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHandleCommandError.mockImplementation(() => {
      throw new Error('COMMAND_EXIT');
    });
  });

  it('rejects validate/register/unregister without required inputs', async () => {
    const cases: Array<{
      args: string[];
      message: string;
      suggestion: string;
    }> = [
      {
        args: ['validate'],
        message: '--entity or --entity-file is required',
        suggestion:
          'rhdh-cli catalog validate --entity-file ./catalog-info.yaml',
      },
      {
        args: ['register'],
        message: '--location-url is required',
        suggestion:
          'rhdh-cli catalog register --location-url https://github.com/org/repo/blob/main/catalog-info.yaml',
      },
      {
        args: ['unregister'],
        message: '--location-id or --location-url is required',
        suggestion: 'rhdh-cli catalog unregister --location-id <id>',
      },
    ];

    for (const { args, message, suggestion } of cases) {
      jest.clearAllMocks();
      mockHandleCommandError.mockImplementation(() => {
        throw new Error('COMMAND_EXIT');
      });

      await expect(parseCatalog(...args)).rejects.toThrow('COMMAND_EXIT');
      expect(mockHandleCommandError).toHaveBeenCalledTimes(1);
      expect(mockHandleCommandError).toHaveBeenCalledWith(
        expect.objectContaining({ message }),
        'human',
        { suggestion },
      );
      expect(mockRunRawAction).not.toHaveBeenCalled();
    }
  });
});

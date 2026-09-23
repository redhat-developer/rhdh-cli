import { Command } from 'commander';
import { handleCommandError } from './intent-errors';
import { registerSearchCommands } from './search';

jest.mock('./helpers');
jest.mock('./intent-errors');

const mockHandleCommandError = handleCommandError as jest.MockedFunction<
  typeof handleCommandError
>;

async function parseSearch(...args: string[]) {
  const program = new Command();
  registerSearchCommands(program);
  await program.parseAsync(['node', 'test', 'search', ...args]);
}

describe('search command validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects an empty term and an invalid --filter', async () => {
    await parseSearch('');
    expect(mockHandleCommandError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Search term is required' }),
      'human',
      { suggestion: 'rhdh-cli search "my service"' },
    );

    jest.clearAllMocks();
    await parseSearch('rhdh', '--filter', 'kind');
    expect(mockHandleCommandError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Invalid "key=value" pair'),
      }),
      'human',
      {
        suggestion: 'rhdh-cli search "my service" --filter kind=Component',
      },
    );
  });
});

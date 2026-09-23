import { Command } from 'commander';
import { runSearchAction } from './helpers';
import { handleCommandError } from './intent-errors';
import { registerSearchCommands } from './search';

jest.mock('./helpers');
jest.mock('./intent-errors');

const mockRunSearchAction = runSearchAction as jest.MockedFunction<
  typeof runSearchAction
>;
const mockHandleCommandError = handleCommandError as jest.MockedFunction<
  typeof handleCommandError
>;

async function parseSearch(...args: string[]) {
  const program = new Command();
  registerSearchCommands(program);
  await program.parseAsync(['node', 'test', 'search', ...args]);
}

describe('search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes term, filters, types, and output mode to runSearchAction', async () => {
    await parseSearch(
      'my',
      'service',
      '--types',
      'techdocs,software-catalog',
      '--filter',
      'kind=Component',
      '--output',
      'json',
    );

    expect(mockRunSearchAction).toHaveBeenCalledWith(
      'my service',
      {
        types: JSON.stringify(['techdocs', 'software-catalog']),
        filters: JSON.stringify({ kind: 'Component' }),
        pageLimit: undefined,
        pageCursor: undefined,
        instance: undefined,
      },
      'json',
      'rhdh-cli search "deployment guide" --filter kind=Component',
    );
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

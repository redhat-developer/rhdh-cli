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

describe('search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes term + filter/types to runSearchAction', async () => {
    const program = new Command();
    registerSearchCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'search',
      'my',
      'service',
      '--types',
      'techdocs,software-catalog',
      '--filter',
      'kind=Component',
    ]);

    expect(mockRunSearchAction).toHaveBeenCalledWith(
      'my service',
      {
        types: JSON.stringify(['techdocs', 'software-catalog']),
        filters: JSON.stringify({ kind: 'Component' }),
        pageLimit: undefined,
        pageCursor: undefined,
        instance: undefined,
      },
      'human',
      'rhdh-cli search "deployment guide" --filter kind=Component',
    );
  });

  it('calls handleCommandError when the search term is empty', async () => {
    const program = new Command();
    registerSearchCommands(program);

    await program.parseAsync(['node', 'test', 'search', '']);

    expect(mockHandleCommandError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Search term is required' }),
      'human',
      { suggestion: 'rhdh-cli search "my service"' },
    );
  });

  it('uses json mode for --output json', async () => {
    const program = new Command();
    registerSearchCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'search',
      'rhdh',
      '--output',
      'json',
    ]);

    expect(mockRunSearchAction).toHaveBeenCalledWith(
      'rhdh',
      expect.any(Object),
      'json',
      'rhdh-cli search "deployment guide" --filter kind=Component',
    );
  });

  it('calls handleCommandError for an invalid --filter missing =', async () => {
    const program = new Command();
    registerSearchCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'search',
      'rhdh',
      '--filter',
      'kind',
    ]);

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

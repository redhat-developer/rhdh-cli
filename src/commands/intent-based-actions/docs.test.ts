import { Command } from 'commander';
import { execActionJson } from './client';
import { registerDocsCommands } from './docs';
import { handleCommandError } from './intent-errors';

jest.mock('./client');
jest.mock('./intent-errors');

const mockExecActionJson = execActionJson as jest.MockedFunction<
  typeof execActionJson
>;
const mockHandleCommandError = handleCommandError as jest.MockedFunction<
  typeof handleCommandError
>;

function captureStdout() {
  return jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
}

describe('docs coverage', () => {
  let writeSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    writeSpy = captureStdout();
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('uses N/A when coverage fields are missing from the response', async () => {
    mockExecActionJson.mockReturnValue({ totalEntities: 10 });
    const program = new Command();
    registerDocsCommands(program);

    await program.parseAsync(['node', 'test', 'docs', 'coverage']);

    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain('Total entities:       10');
    expect(output).toContain('Documented entities:  N/A');
    expect(output).toContain('Coverage:             N/A');
  });

  it('explains that RHDH is required when the coverage action is unavailable', async () => {
    const error = new Error('Unknown action');
    mockExecActionJson.mockImplementation(() => {
      throw error;
    });
    const program = new Command();
    registerDocsCommands(program);

    await program.parseAsync(['node', 'test', 'docs', 'coverage']);

    expect(mockHandleCommandError).toHaveBeenCalledWith(error, 'human', {
      suggestion: 'Use an RHDH instance with techdocs-mcp-extras enabled.',
    });
  });
});

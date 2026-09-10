import { Command } from 'commander';
import { execActionJson } from './client';
import { registerDocsCommands } from './docs';
import { resolveEntityWithAmbiguityCheck } from './helpers';
import { handleCommandError } from './intent-errors';

jest.mock('./client');
jest.mock('./helpers');
jest.mock('./intent-errors');

const mockExecActionJson = execActionJson as jest.MockedFunction<
  typeof execActionJson
>;
const mockHandleCommandError = handleCommandError as jest.MockedFunction<
  typeof handleCommandError
>;
const mockResolveEntityWithAmbiguityCheck =
  resolveEntityWithAmbiguityCheck as jest.MockedFunction<
    typeof resolveEntityWithAmbiguityCheck
  >;

function captureStdout() {
  return jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
}

describe('docs get', () => {
  it('reports an unresolved entity as a catalog error', async () => {
    const error = new Error('Entity not found');
    mockResolveEntityWithAmbiguityCheck.mockRejectedValue(error);
    const stderrSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const program = new Command();
    registerDocsCommands(program);

    await program.parseAsync(['node', 'test', 'docs', 'get', 'missing']);

    expect(stderrSpy).not.toHaveBeenCalled();
    expect(mockHandleCommandError).toHaveBeenCalledWith(error, 'human', {
      suggestion: 'Use an RHDH instance with techdocs-mcp-extras enabled.',
    });

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe('docs list', () => {
  it('rejects the unsupported --limit option', async () => {
    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    registerDocsCommands(program);

    await expect(
      program.parseAsync(['node', 'test', 'docs', 'list', '--limit', '5']),
    ).rejects.toMatchObject({ code: 'commander.unknownOption' });
  });
});

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

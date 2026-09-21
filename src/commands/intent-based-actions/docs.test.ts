import { Command } from 'commander';
import { execAction, execActionJson, triggerTechDocsBuild } from './client';
import { registerDocsCommands } from './docs';
import { resolveEntityWithAmbiguityCheck, runSearchAction } from './helpers';
import { handleCommandError } from './intent-errors';

jest.mock('./client');
jest.mock('./helpers');
jest.mock('./intent-errors');

const mockExecActionJson = execActionJson as jest.MockedFunction<
  typeof execActionJson
>;
const mockExecAction = execAction as jest.MockedFunction<typeof execAction>;
const mockTriggerTechDocsBuild = triggerTechDocsBuild as jest.MockedFunction<
  typeof triggerTechDocsBuild
>;
const mockHandleCommandError = handleCommandError as jest.MockedFunction<
  typeof handleCommandError
>;
const mockRunSearchAction = runSearchAction as jest.MockedFunction<
  typeof runSearchAction
>;
const mockResolveEntityWithAmbiguityCheck =
  resolveEntityWithAmbiguityCheck as jest.MockedFunction<
    typeof resolveEntityWithAmbiguityCheck
  >;

function captureStdout() {
  return jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
}

describe('docs get', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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
    expect(mockHandleCommandError).toHaveBeenCalledWith(error, 'human');

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('verifies that a full entity reference exists before retrieving docs', async () => {
    const error = new Error('Entity not found: system:default/missing');
    mockResolveEntityWithAmbiguityCheck.mockRejectedValue(error);
    const program = new Command();
    registerDocsCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'docs',
      'get',
      'system:default/missing',
    ]);

    expect(mockResolveEntityWithAmbiguityCheck).toHaveBeenCalledWith(
      'system:default/missing',
      expect.objectContaining({ verifyExists: true }),
    );
    expect(mockHandleCommandError).toHaveBeenCalledWith(error, 'human');
    expect(mockExecActionJson).not.toHaveBeenCalled();
  });

  it('reports missing generated docs as an error', async () => {
    mockResolveEntityWithAmbiguityCheck.mockResolvedValue({
      entityRef: 'System:default/rhdh-local',
      kind: 'System',
      namespace: 'default',
      name: 'rhdh-local',
    });
    mockExecActionJson.mockReturnValue({
      error: 'TechDocs content not found',
    });
    const stderrSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const program = new Command();
    registerDocsCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'docs',
      'get',
      'system:default/rhdh-local',
    ]);

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'TechDocs content not found for System:default/rhdh-local',
      ),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('reports missing generated docs as a structured JSON error', async () => {
    mockResolveEntityWithAmbiguityCheck.mockResolvedValue({
      entityRef: 'System:default/rhdh-local',
      kind: 'System',
      namespace: 'default',
      name: 'rhdh-local',
    });
    mockExecAction.mockReturnValue(
      JSON.stringify({ error: 'TechDocs content not found' }),
    );
    const stdoutSpy = captureStdout();
    const program = new Command();
    registerDocsCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'docs',
      'get',
      'system:default/rhdh-local',
      '--output',
      'json',
    ]);

    expect(mockHandleCommandError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'TechDocs content not found for System:default/rhdh-local',
      }),
      'json',
      { suggestion: 'rhdh-cli docs build System:default/rhdh-local' },
    );
    stdoutSpy.mockRestore();
  });
});

describe('docs search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('suggests enabling the TechDocs search backend when search fails', async () => {
    const program = new Command();
    registerDocsCommands(program);

    await program.parseAsync(['node', 'test', 'docs', 'search', 'rhdh']);

    expect(mockRunSearchAction).toHaveBeenCalledWith(
      'rhdh',
      expect.objectContaining({ types: '["techdocs"]' }),
      'human',
      'Enable search-backend-module-techdocs on the RHDH instance.',
    );
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

describe('docs build', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls the authenticated TechDocs sync endpoint before reporting success', async () => {
    mockResolveEntityWithAmbiguityCheck.mockResolvedValue({
      entityRef: 'Component:default/my-service',
      kind: 'Component',
      namespace: 'default',
      name: 'my-service',
    });
    mockTriggerTechDocsBuild.mockResolvedValue('build output');
    const writeSpy = captureStdout();
    const program = new Command();
    registerDocsCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'docs',
      'build',
      'component:default/my-service',
      '--instance',
      'local',
    ]);

    expect(mockResolveEntityWithAmbiguityCheck).toHaveBeenCalledWith(
      'component:default/my-service',
      expect.objectContaining({ verifyExists: true }),
    );
    expect(mockTriggerTechDocsBuild).toHaveBeenCalledWith(
      {
        kind: 'component',
        namespace: 'default',
        name: 'my-service',
      },
      'local',
    );
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining('TechDocs build completed'),
    );
    writeSpy.mockRestore();
  });
});

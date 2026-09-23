import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import {
  resolveEntityWithAmbiguityCheck,
  runEntityListAction,
  runRawAction,
} from './helpers';
import { handleCommandError } from './intent-errors';
import { registerTemplateCommands } from './template';

jest.mock('./helpers');
jest.mock('./intent-errors');

const mockRunEntityListAction = runEntityListAction as jest.MockedFunction<
  typeof runEntityListAction
>;
const mockRunRawAction = runRawAction as jest.MockedFunction<
  typeof runRawAction
>;
const mockResolveEntityWithAmbiguityCheck =
  resolveEntityWithAmbiguityCheck as jest.MockedFunction<
    typeof resolveEntityWithAmbiguityCheck
  >;
const mockHandleCommandError = handleCommandError as jest.MockedFunction<
  typeof handleCommandError
>;

describe('template list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requests only the fields rendered in human output', async () => {
    const program = new Command();
    registerTemplateCommands(program);

    await program.parseAsync(['node', 'test', 'template', 'list']);

    expect(mockRunEntityListAction).toHaveBeenCalledWith(
      'catalog:query-catalog-entities',
      {
        query: JSON.stringify({ kind: 'Template' }),
        instance: undefined,
        limit: undefined,
        fields: JSON.stringify([
          'metadata.name',
          'kind',
          'metadata.namespace',
          'spec.type',
        ]),
      },
      'human',
    );
  });

  it('does not set fields for --output json', async () => {
    const program = new Command();
    registerTemplateCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'template',
      'list',
      '--output',
      'json',
    ]);

    expect(mockRunEntityListAction).toHaveBeenCalledWith(
      'catalog:query-catalog-entities',
      {
        query: JSON.stringify({ kind: 'Template' }),
        instance: undefined,
        limit: undefined,
        fields: undefined,
      },
      'json',
    );
  });
});

describe('template execute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves the ref and calls runRawAction with scaffolder:execute-template', async () => {
    mockResolveEntityWithAmbiguityCheck.mockResolvedValue({
      entityRef: 'template:default/react-ssr',
      kind: 'Template',
      namespace: 'default',
      name: 'react-ssr',
    });
    const program = new Command();
    registerTemplateCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'template',
      'execute',
      'react-ssr',
      '--value',
      'name=my-app',
    ]);

    expect(mockResolveEntityWithAmbiguityCheck).toHaveBeenCalledWith(
      'react-ssr',
      expect.objectContaining({ defaultKind: 'template' }),
    );
    expect(mockRunRawAction).toHaveBeenCalledWith(
      'scaffolder:execute-template',
      {
        templateRef: 'template:default/react-ssr',
        values: JSON.stringify({ name: 'my-app' }),
        secrets: undefined,
        instance: undefined,
      },
      'human',
      'rhdh-cli template list',
    );
  });
});

describe('template dry-run', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls handleCommandError without --template-file', async () => {
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

  it('reads YAML from --template-file and calls scaffolder:dry-run-template', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rhdh-cli-template-'));
    const templateFile = join(dir, 'template.yaml');
    const yaml = [
      'apiVersion: scaffolder.backstage.io/v1beta3',
      'kind: Template',
      'metadata:',
      '  name: demo',
      'spec:',
      '  steps: []',
    ].join('\n');
    writeFileSync(templateFile, yaml);

    const program = new Command();
    registerTemplateCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'template',
      'dry-run',
      '--template-file',
      templateFile,
      '--value',
      'name=demo',
    ]);

    expect(mockRunRawAction).toHaveBeenCalledWith(
      'scaffolder:dry-run-template',
      {
        templateYaml: yaml,
        values: JSON.stringify({ name: 'demo' }),
        instance: undefined,
      },
      'human',
      'rhdh-cli template list',
    );
  });
});

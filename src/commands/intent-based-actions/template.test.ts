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

async function parseTemplate(...args: string[]) {
  const program = new Command();
  registerTemplateCommands(program);
  await program.parseAsync(['node', 'test', 'template', ...args]);
}

describe('template', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('list selects human table fields and omits them for json', async () => {
    await parseTemplate('list');
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

    jest.clearAllMocks();
    await parseTemplate('list', '--output', 'json');
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

  it('execute resolves the ref and dry-run reads YAML or rejects missing file', async () => {
    mockResolveEntityWithAmbiguityCheck.mockResolvedValue({
      entityRef: 'template:default/react-ssr',
      kind: 'Template',
      namespace: 'default',
      name: 'react-ssr',
    });

    await parseTemplate('execute', 'react-ssr', '--value', 'name=my-app');
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

    jest.clearAllMocks();
    await parseTemplate('dry-run');
    expect(mockHandleCommandError).toHaveBeenCalledWith(
      expect.objectContaining({ message: '--template-file is required' }),
      'human',
      {
        suggestion:
          'rhdh-cli template dry-run --template-file ./template.yaml --value name=my-app',
      },
    );

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

    jest.clearAllMocks();
    await parseTemplate(
      'dry-run',
      '--template-file',
      templateFile,
      '--value',
      'name=demo',
    );
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

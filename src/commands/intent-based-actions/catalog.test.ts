import { Command } from 'commander';
import { registerCatalogCommands } from './catalog';
import {
  resolveEntityWithAmbiguityCheck,
  runEntityListAction,
  runRawAction,
} from './helpers';
import { handleCommandError } from './intent-errors';

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

const HUMAN_FIELDS = JSON.stringify([
  'metadata.name',
  'kind',
  'metadata.namespace',
  'spec.type',
]);

async function parseCatalog(...args: string[]) {
  const program = new Command();
  registerCatalogCommands(program);
  await program.parseAsync(['node', 'test', 'catalog', ...args]);
}

describe('catalog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('list selects default fields for human output and omits them for json', async () => {
    await parseCatalog('list', '--kind', 'template');
    expect(mockRunEntityListAction).toHaveBeenCalledWith(
      'catalog:query-catalog-entities',
      {
        instance: undefined,
        limit: undefined,
        query: JSON.stringify({ kind: 'template' }),
        fields: HUMAN_FIELDS,
      },
      'human',
      'rhdh-cli catalog list --kind Component',
      undefined,
    );

    jest.clearAllMocks();
    await parseCatalog('list', '--kind', 'Component', '--output', 'json');
    expect(mockRunEntityListAction).toHaveBeenCalledWith(
      'catalog:query-catalog-entities',
      {
        instance: undefined,
        limit: undefined,
        query: JSON.stringify({ kind: 'Component' }),
        fields: undefined,
      },
      'json',
      'rhdh-cli catalog list --kind Component',
      undefined,
    );
  });

  it('get resolves the entity and calls runRawAction', async () => {
    mockResolveEntityWithAmbiguityCheck.mockResolvedValue({
      entityRef: 'component:default/my-service',
      kind: 'Component',
      namespace: 'default',
      name: 'my-service',
    });

    await parseCatalog('get', 'my-service', '--kind', 'Component');

    expect(mockResolveEntityWithAmbiguityCheck).toHaveBeenCalledWith(
      'my-service',
      expect.objectContaining({ kindFlag: 'Component' }),
    );
    expect(mockRunRawAction).toHaveBeenCalledWith(
      'catalog:get-catalog-entity',
      {
        name: 'my-service',
        kind: 'Component',
        namespace: 'default',
        instance: undefined,
      },
      'human',
      'rhdh-cli catalog get my-service',
    );
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
      await parseCatalog(...args);
      expect(mockHandleCommandError).toHaveBeenCalledWith(
        expect.objectContaining({ message }),
        'human',
        { suggestion },
      );
    }
  });
});

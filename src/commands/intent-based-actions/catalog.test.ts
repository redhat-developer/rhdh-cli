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

describe('catalog list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requests only the default table fields in human output', async () => {
    const program = new Command();
    registerCatalogCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'catalog',
      'list',
      '--kind',
      'template',
    ]);

    expect(mockRunEntityListAction).toHaveBeenCalledWith(
      'catalog:query-catalog-entities',
      {
        instance: undefined,
        limit: undefined,
        query: JSON.stringify({ kind: 'template' }),
        fields: JSON.stringify([
          'metadata.name',
          'kind',
          'metadata.namespace',
          'spec.type',
        ]),
      },
      'human',
      'rhdh-cli catalog list --kind Component',
      undefined,
    );
  });

  it('omits default human fields for --output json', async () => {
    const program = new Command();
    registerCatalogCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'catalog',
      'list',
      '--kind',
      'Component',
      '--output',
      'json',
    ]);

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
});

describe('catalog get', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves the entity and calls runRawAction', async () => {
    mockResolveEntityWithAmbiguityCheck.mockResolvedValue({
      entityRef: 'component:default/my-service',
      kind: 'Component',
      namespace: 'default',
      name: 'my-service',
    });
    const program = new Command();
    registerCatalogCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'catalog',
      'get',
      'my-service',
      '--kind',
      'Component',
    ]);

    expect(mockResolveEntityWithAmbiguityCheck).toHaveBeenCalledWith(
      'my-service',
      expect.objectContaining({
        kindFlag: 'Component',
      }),
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
});

describe('catalog validate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls handleCommandError without entity or entity-file', async () => {
    const program = new Command();
    registerCatalogCommands(program);

    await program.parseAsync(['node', 'test', 'catalog', 'validate']);

    expect(mockHandleCommandError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '--entity or --entity-file is required',
      }),
      'human',
      {
        suggestion:
          'rhdh-cli catalog validate --entity-file ./catalog-info.yaml',
      },
    );
  });
});

describe('catalog register', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls handleCommandError without --location-url', async () => {
    const program = new Command();
    registerCatalogCommands(program);

    await program.parseAsync(['node', 'test', 'catalog', 'register']);

    expect(mockHandleCommandError).toHaveBeenCalledWith(
      expect.objectContaining({ message: '--location-url is required' }),
      'human',
      {
        suggestion:
          'rhdh-cli catalog register --location-url https://github.com/org/repo/blob/main/catalog-info.yaml',
      },
    );
  });
});

describe('catalog unregister', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls handleCommandError without location', async () => {
    const program = new Command();
    registerCatalogCommands(program);

    await program.parseAsync(['node', 'test', 'catalog', 'unregister']);

    expect(mockHandleCommandError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '--location-id or --location-url is required',
      }),
      'human',
      { suggestion: 'rhdh-cli catalog unregister --location-id <id>' },
    );
  });
});

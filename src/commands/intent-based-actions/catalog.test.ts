import { Command } from 'commander';
import { registerCatalogCommands } from './catalog';
import { runEntityListAction } from './helpers';

jest.mock('./helpers');

const mockRunEntityListAction = runEntityListAction as jest.MockedFunction<
  typeof runEntityListAction
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
});

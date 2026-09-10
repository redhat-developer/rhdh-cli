import { Command } from 'commander';
import { runEntityListAction } from './helpers';
import { registerTemplateCommands } from './template';

jest.mock('./helpers');

const mockRunEntityListAction = runEntityListAction as jest.MockedFunction<
  typeof runEntityListAction
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
});

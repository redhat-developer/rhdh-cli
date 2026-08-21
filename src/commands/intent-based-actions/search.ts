import { Command } from 'commander';
import { runSearchAction } from './helpers';
import { parseOutputFlag } from './format';
import { handleCommandError } from './intent-errors';

export function registerSearchCommands(program: Command) {
  program
    .command('search <term...>')
    .description(
      'Search across all content types (catalog, TechDocs, templates)',
    )
    .option(
      '--types <json>',
      'Document types (JSON array, e.g. \'["techdocs"]\')',
    )
    .option('--filters <json>', 'Query filters (JSON)')
    .option('--page-limit <n>', 'Results per page (default: 10)', parseInt)
    .option('--page-cursor <cursor>', 'Pagination cursor')
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async (termParts: string[], opts) => {
      const mode = parseOutputFlag(opts.output);
      const term = termParts.join(' ');

      if (!term) {
        handleCommandError(new Error('Search term is required'), mode, {
          suggestion: 'rhdh-cli search "my service"',
        });
      }

      await runSearchAction(
        term,
        {
          types: opts.types,
          filters: opts.filters,
          pageLimit: opts.pageLimit,
          pageCursor: opts.pageCursor,
          instance: opts.instance,
        },
        mode,
        'rhdh-cli search "deployment guide"',
      );
    });
}

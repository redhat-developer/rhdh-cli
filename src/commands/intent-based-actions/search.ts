import { Command } from 'commander';
import { runSearchAction } from './helpers';
import { parseOutputFlag } from './format';
import { handleCommandError } from './intent-errors';
import { collect, parseList, resolveJsonInput } from './kv';

export function registerSearchCommands(program: Command) {
  program
    .command('search <term...>')
    .description(
      'Search across all content types (catalog, TechDocs, templates)',
    )
    .option(
      '--types <list>',
      'Comma-separated document types, e.g. --types techdocs,software-catalog',
    )
    .option(
      '--filter <key=value>',
      'Query filter, e.g. --filter kind=Component (repeatable)',
      collect,
      [] as string[],
    )
    .option(
      '--filters <json>',
      'Query filters as a JSON string (alternative to --filter)',
    )
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

      let filters: string | undefined;
      try {
        filters = resolveJsonInput(opts.filter, opts.filters);
      } catch (error) {
        handleCommandError(error, mode, {
          suggestion: 'rhdh-cli search "my service" --filter kind=Component',
        });
      }

      const types = parseList(opts.types);

      await runSearchAction(
        term,
        {
          types: types ? JSON.stringify(types) : undefined,
          filters,
          pageLimit: opts.pageLimit,
          pageCursor: opts.pageCursor,
          instance: opts.instance,
        },
        mode,
        'rhdh-cli search "deployment guide" --filter kind=Component',
      );
    });
}

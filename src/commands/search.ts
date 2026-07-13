import { Command } from 'commander';
import { execAction, execActionJson } from '../lib/client';
import { parseOutputFlag, writeOutput, formatSearchResults } from '../lib/format';
import { handleCommandError } from '../lib/intent-errors';

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

      try {
        const flags: Record<string, string | number | undefined> = {
          term,
          types: opts.types,
          filters: opts.filters,
          pageLimit: opts.pageLimit,
          pageCursor: opts.pageCursor,
          instance: opts.instance,
        };

        if (mode === 'json') {
          process.stdout.write(await execAction('search:query', flags));
        } else {
          const result = (await execActionJson(
            'search:query',
            flags,
          )) as Record<string, unknown>;
          const results = (result?.results ?? result) as Array<
            Record<string, unknown>
          >;
          writeOutput(
            Array.isArray(results) ? results : result,
            mode,
            data =>
              formatSearchResults(data as Array<Record<string, unknown>>),
          );
        }
      } catch (error) {
        handleCommandError(error, mode, {
          suggestion: 'rhdh-cli search "deployment guide"',
        });
      }
    });
}

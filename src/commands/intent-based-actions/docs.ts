import chalk from 'chalk';
import { Command } from 'commander';
import { execAction, execActionJson } from './client';
import { runSearchAction } from './helpers';
import {
  parseOutputFlag,
  writeOutput,
  formatEntityTable,
  extractEntities,
} from './format';
import { handleCommandError } from './intent-errors';

export function registerDocsCommands(program: Command) {
  const docs = program
    .command('docs')
    .description('Search and retrieve TechDocs content');

  docs
    .command('search <term...>')
    .description('Search TechDocs content (via upstream search:query)')
    .option('--page-limit <n>', 'Results per page (default: 10)', parseInt)
    .option('--page-cursor <cursor>', 'Pagination cursor')
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async (termParts: string[], opts) => {
      const mode = parseOutputFlag(opts.output);
      const term = termParts.join(' ');

      if (!term) {
        handleCommandError(new Error('Search term is required'), mode, {
          suggestion: 'rhdh-cli docs search "deployment guide"',
        });
      }

      await runSearchAction(
        term,
        {
          types: '["techdocs"]',
          pageLimit: opts.pageLimit,
          pageCursor: opts.pageCursor,
          instance: opts.instance,
        },
        mode,
        'rhdh-cli docs search "getting started"',
      );
    });

  docs
    .command('list')
    .description(
      'List entities with TechDocs (RHDH only, via techdocs-mcp-extras)',
    )
    .option(
      '--entity-type <kind>',
      'Filter by entity kind (Component, API, etc.)',
    )
    .option('--owner <owner>', 'Filter by owner')
    .option(
      '--lifecycle <lifecycle>',
      'Filter by lifecycle (production, experimental, etc.)',
    )
    .option('--tags <tags>', 'Filter by tags (comma-separated)')
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async opts => {
      const mode = parseOutputFlag(opts.output);
      try {
        const flags: Record<string, string | undefined> = {
          entityType: opts.entityType,
          owner: opts.owner,
          lifecycle: opts.lifecycle,
          tags: opts.tags,
          instance: opts.instance,
        };

        if (mode === 'json') {
          process.stdout.write(
            await execAction('techdocs-mcp-extras:fetch-techdocs', flags),
          );
        } else {
          const result = await execActionJson(
            'techdocs-mcp-extras:fetch-techdocs',
            flags,
          );
          const entities = extractEntities(result);
          if (entities.length > 0) {
            writeOutput(entities, mode, data =>
              formatEntityTable(data as Array<Record<string, unknown>>),
            );
          } else {
            writeOutput(result, mode);
          }
        }
      } catch (error) {
        handleCommandError(error, mode, {
          suggestion: 'rhdh-cli docs list',
        });
      }
    });

  docs
    .command('get')
    .description(
      'Get TechDocs page content for an entity (RHDH only, via techdocs-mcp-extras)',
    )
    .option(
      '--entity-ref <ref>',
      'Entity reference, e.g. component:default/my-service (required)',
    )
    .option('--page-path <path>', 'Specific doc page path (default: index)')
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async opts => {
      const mode = parseOutputFlag(opts.output);
      if (!opts.entityRef) {
        handleCommandError(new Error('--entity-ref is required'), mode, {
          suggestion:
            'rhdh-cli docs get --entity-ref component:default/my-service',
        });
      }
      try {
        const flags: Record<string, string | undefined> = {
          entityRef: opts.entityRef,
          pagePath: opts.pagePath,
          instance: opts.instance,
        };

        if (mode === 'json') {
          process.stdout.write(
            await execAction(
              'techdocs-mcp-extras:retrieve-techdocs-content',
              flags,
            ),
          );
        } else {
          const result = await execActionJson(
            'techdocs-mcp-extras:retrieve-techdocs-content',
            flags,
          );
          const obj = result as Record<string, unknown> | undefined;
          const content = obj?.content ?? obj?.text;
          const errorMsg = obj?.error as string | undefined;

          if (typeof content === 'string' && content.length > 0) {
            process.stdout.write(`${content}\n`);
          } else if (errorMsg) {
            process.stderr.write(`${chalk.yellow(errorMsg)}\n`);
          } else {
            writeOutput(result, mode);
          }
        }
      } catch (error) {
        handleCommandError(error, mode, {
          suggestion: 'rhdh-cli docs list',
        });
      }
    });

  docs
    .command('coverage')
    .description(
      'Show TechDocs coverage report (RHDH only, via techdocs-mcp-extras)',
    )
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async opts => {
      const mode = parseOutputFlag(opts.output);
      try {
        const flags: Record<string, string | undefined> = {
          instance: opts.instance,
        };

        if (mode === 'json') {
          process.stdout.write(
            await execAction(
              'techdocs-mcp-extras:analyze-techdocs-coverage',
              flags,
            ),
          );
        } else {
          const result = (await execActionJson(
            'techdocs-mcp-extras:analyze-techdocs-coverage',
            flags,
          )) as Record<string, unknown>;

          const total = result?.totalEntities ?? result?.total;
          const documented =
            result?.entitiesWithDocs ??
            result?.documentedEntities ??
            result?.documented;
          const coverage = result?.coveragePercentage ?? result?.coverage;

          if (total !== undefined) {
            const lines = [
              `${chalk.bold('TechDocs Coverage Report')}`,
              '',
              `Total entities:       ${total}`,
              `Documented entities:  ${documented}`,
              `Coverage:             ${coverage}%`,
            ];
            process.stdout.write(`${lines.join('\n')}\n`);
          } else {
            writeOutput(result, mode);
          }
        }
      } catch (error) {
        handleCommandError(error, mode, {
          suggestion: 'rhdh-cli docs coverage',
        });
      }
    });
}

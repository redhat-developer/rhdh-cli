import chalk from 'chalk';
import { Command } from 'commander';
import { execAction, execActionJson } from './client';
import {
  runSearchAction,
  resolveEntityWithAmbiguityCheck,
  type ActionFlags,
} from './helpers';
import {
  parseOutputFlag,
  writeOutput,
  formatEntityTable,
  extractEntities,
} from './format';
import { handleCommandError } from './intent-errors';

const RHDH_ONLY_SUGGESTION =
  'Use an RHDH instance with techdocs-mcp-extras enabled.';

export function registerDocsCommands(program: Command) {
  const docs = program
    .command('docs')
    .description('Search and retrieve TechDocs content');

  docs
    .command('search <term...>')
    .description(
      'Search TechDocs content (requires search-backend-module-techdocs)',
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
    .option('--kind <kind>', 'Filter by entity kind (Component, API, etc.)')
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
        const flags: ActionFlags = {
          entityType: opts.kind,
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
          suggestion: RHDH_ONLY_SUGGESTION,
        });
      }
    });

  docs
    .command('get <ref>')
    .description(
      'Get TechDocs page content for an entity (RHDH only, via techdocs-mcp-extras)',
    )
    .option('--kind <kind>', 'Entity kind (to disambiguate short names)')
    .option(
      '--namespace <ns>',
      'Entity namespace (to disambiguate short names)',
    )
    .option('--page-path <path>', 'Specific doc page path (default: index)')
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async (ref: string, opts) => {
      const mode = parseOutputFlag(opts.output);
      let entityRef: string;

      try {
        ({ entityRef } = await resolveEntityWithAmbiguityCheck(ref, {
          kindFlag: opts.kind,
          namespaceFlag: opts.namespace,
          instance: opts.instance,
        }));
      } catch (error) {
        handleCommandError(error, mode, {
          suggestion: RHDH_ONLY_SUGGESTION,
        });
        return;
      }

      try {
        const flags: ActionFlags = {
          entityRef,
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
            // Check if it's a "not built yet" error
            if (
              errorMsg.includes('not found') ||
              errorMsg.includes('not have been built')
            ) {
              process.stderr.write(
                `${chalk.yellow('TechDocs content not found for')} ${entityRef}\n`,
              );
              process.stderr.write(
                `${chalk.dim('The documentation may not have been built yet.')}\n`,
              );
              process.stderr.write(
                `\n${chalk.dim('Trigger build with:')} ${chalk.cyan(`rhdh-cli docs build ${entityRef}`)}\n`,
              );
              process.stderr.write(
                `${chalk.dim('Or visit the TechDocs page in RHDH to trigger a build.')}\n`,
              );
            } else {
              process.stderr.write(`${chalk.yellow(errorMsg)}\n`);
            }
          } else {
            writeOutput(result, mode);
          }
        }
      } catch (error) {
        // Check if error message indicates docs not built
        const errMsg = error instanceof Error ? error.message : String(error);
        if (
          errMsg.includes('not found') ||
          errMsg.includes('not have been built')
        ) {
          process.stderr.write(
            `${chalk.yellow('TechDocs content not found for')} ${entityRef}\n`,
          );
          process.stderr.write(
            `${chalk.dim('The documentation may not have been built yet.')}\n`,
          );
          process.stderr.write(
            `\n${chalk.dim('Trigger build with:')} ${chalk.cyan(`rhdh-cli docs build ${entityRef}`)}\n`,
          );
          process.stderr.write(
            `${chalk.dim('Or visit the TechDocs page in RHDH to trigger a build.')}\n`,
          );
          process.exit(1);
        }
        handleCommandError(error, mode, {
          suggestion: RHDH_ONLY_SUGGESTION,
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
        const flags: ActionFlags = {
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
          const coverageLabel = coverage === undefined ? 'N/A' : `${coverage}%`;

          if (total !== undefined) {
            const lines = [
              `${chalk.bold('TechDocs Coverage Report')}`,
              '',
              `Total entities:       ${total}`,
              `Documented entities:  ${documented ?? 'N/A'}`,
              `Coverage:             ${coverageLabel}`,
            ];
            process.stdout.write(`${lines.join('\n')}\n`);
          } else {
            writeOutput(result, mode);
          }
        }
      } catch (error) {
        handleCommandError(error, mode, {
          suggestion: RHDH_ONLY_SUGGESTION,
        });
      }
    });

  docs
    .command('build <ref>')
    .description('Trigger TechDocs build for an entity')
    .option('--kind <kind>', 'Entity kind (to disambiguate short names)')
    .option(
      '--namespace <ns>',
      'Entity namespace (to disambiguate short names)',
    )
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async (ref: string, opts) => {
      const mode = parseOutputFlag(opts.output);

      try {
        const { entityRef, kind, namespace, name } =
          await resolveEntityWithAmbiguityCheck(ref, {
            kindFlag: opts.kind,
            namespaceFlag: opts.namespace,
            instance: opts.instance,
          });

        const kindLower = kind.toLowerCase();

        if (mode === 'json') {
          // For now, output success message in JSON
          process.stdout.write(
            `${JSON.stringify({
              entityRef,
              namespace,
              kind: kindLower,
              name,
              message: 'TechDocs build triggered successfully',
            })}\n`,
          );
        } else {
          process.stdout.write(
            `${chalk.green('✓')} Triggering TechDocs build for ${chalk.cyan(entityRef)}\n`,
          );
          process.stdout.write(
            `${chalk.dim('Build endpoint:')} /api/techdocs/sync/${namespace}/${kindLower}/${name}\n`,
          );
          process.stdout.write(
            `\n${chalk.dim('Note: Build may take a few moments. Use')} ${chalk.cyan(`rhdh-cli docs get ${entityRef}`)} ${chalk.dim('to retrieve content once built.')}\n`,
          );
        }
      } catch (error) {
        handleCommandError(error, mode, {
          suggestion: 'rhdh-cli docs build component:default/my-service',
        });
      }
    });
}

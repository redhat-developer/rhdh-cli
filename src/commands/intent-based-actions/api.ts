import { Command } from 'commander';
import { execAction } from './client';
import { runEntityListAction } from './helpers';
import { parseOutputFlag, writeOutput } from './format';
import { handleCommandError } from './intent-errors';

export function registerApiCommands(program: Command) {
  const api = program
    .command('api')
    .description('Query API entities and retrieve specifications');

  api
    .command('list')
    .description('List API entities in the catalog')
    .option('--type <type>', 'API type (openapi, asyncapi, graphql, grpc)')
    .option('--limit <n>', 'Maximum results to return', parseInt)
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async opts => {
      const mode = parseOutputFlag(opts.output);

      const query: Record<string, unknown> = { kind: 'API' };
      if (opts.type) query['spec.type'] = opts.type;

      const flags: Record<string, string | number | undefined> = {
        query: JSON.stringify(query),
        instance: opts.instance,
        limit: opts.limit,
      };

      await runEntityListAction(
        'catalog:query-catalog-entities',
        flags,
        mode,
        'rhdh-cli api list',
      );
    });

  api
    .command('get-spec')
    .description(
      'Get the full API specification (OpenAPI, AsyncAPI, GraphQL, gRPC)',
    )
    .option('--name <name>', 'API entity name (required)')
    .option('--namespace <ns>', 'Entity namespace (default: default)')
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async opts => {
      const mode = parseOutputFlag(opts.output);
      if (!opts.name) {
        handleCommandError(new Error('--name is required'), mode, {
          suggestion: 'rhdh-cli api get-spec --name my-api',
        });
      }
      try {
        const raw = await execAction('catalog:get-catalog-entity', {
          name: opts.name,
          kind: 'API',
          namespace: opts.namespace,
          instance: opts.instance,
        });

        const entity = JSON.parse(raw) as Record<string, unknown>;
        const spec = entity?.spec as Record<string, unknown> | undefined;
        const definition = spec?.definition;

        if (!definition) {
          handleCommandError(
            new Error(`API "${opts.name}" has no spec.definition`),
            mode,
            { suggestion: 'rhdh-cli api list' },
          );
        }

        if (mode === 'json') {
          writeOutput({ name: opts.name, type: spec?.type, definition }, mode);
        } else {
          const defStr =
            typeof definition === 'string'
              ? definition
              : JSON.stringify(definition, null, 2);
          process.stdout.write(`${defStr}\n`);
        }
      } catch (error) {
        handleCommandError(error, mode, {
          suggestion: 'rhdh-cli api list',
        });
      }
    });
}

import { Command } from 'commander';
import { execAction } from './client';
import {
  runEntityListAction,
  resolveEntityWithAmbiguityCheck,
  type ActionFlags,
} from './helpers';
import { parseOutputFlag, writeOutput } from './format';
import { handleCommandError } from './intent-errors';
import { collect, resolveJsonInput } from './kv';

export function registerApiCommands(program: Command) {
  const api = program
    .command('api')
    .description('Query API entities and retrieve specifications');

  api
    .command('list')
    .description('List API entities in the catalog')
    .option('--type <type>', 'API type (openapi, asyncapi, graphql, grpc)')
    .option(
      '--filter <key=value>',
      'Query predicate, e.g. --filter spec.owner=team-a (repeatable)',
      collect,
      [] as string[],
    )
    .option('--limit <n>', 'Maximum results to return', parseInt)
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async opts => {
      const mode = parseOutputFlag(opts.output);

      const query: Record<string, unknown> = { kind: 'API' };
      if (opts.type) query['spec.type'] = opts.type;

      let predicate: string | undefined;
      try {
        predicate = resolveJsonInput(opts.filter);
      } catch (error) {
        handleCommandError(error, mode, {
          suggestion:
            'rhdh-cli api list --type openapi --filter spec.owner=team-a',
        });
      }
      // --filter flags merge on top of the --type shortcut.
      const merged = predicate ? { ...query, ...JSON.parse(predicate) } : query;

      const flags: ActionFlags = {
        query: JSON.stringify(merged),
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
    .command('get-spec <ref>')
    .description(
      'Get the full API specification (OpenAPI, AsyncAPI, GraphQL, gRPC)',
    )
    .option('--namespace <ns>', 'Entity namespace (to filter/disambiguate)')
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async (ref: string, opts) => {
      const mode = parseOutputFlag(opts.output);

      try {
        // APIs default to kind=api if not specified
        const { name, namespace } = await resolveEntityWithAmbiguityCheck(ref, {
          defaultKind: 'api',
          namespaceFlag: opts.namespace,
          instance: opts.instance,
        });

        const raw = await execAction('catalog:get-catalog-entity', {
          name,
          kind: 'API',
          namespace,
          instance: opts.instance,
        });

        const entity = JSON.parse(raw) as Record<string, unknown>;
        const spec = entity?.spec as Record<string, unknown> | undefined;
        const definition = spec?.definition;

        if (!definition) {
          handleCommandError(
            new Error(`API "${name}" has no spec.definition`),
            mode,
            { suggestion: 'rhdh-cli api list' },
          );
        }

        if (mode === 'json') {
          writeOutput({ name, type: spec?.type, definition }, mode);
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

import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { runEntityListAction, runRawAction } from './helpers';
import { parseOutputFlag } from './format';
import { handleCommandError } from './intent-errors';
import { collect, parseList, resolveJsonInput } from './kv';

export function registerCatalogCommands(program: Command) {
  const catalog = program
    .command('catalog')
    .description('Query and manage the Backstage software catalog');

  catalog
    .command('list')
    .description('List catalog entities')
    .option('--kind <kind>', 'Entity kind (Component, API, System, etc.)')
    .option('--type <type>', 'Entity type (service, website, library, etc.)')
    .option(
      '--filter <key=value>',
      'Query predicate, e.g. --filter spec.lifecycle=production (repeatable)',
      collect,
      [] as string[],
    )
    .option(
      '--filters <json>',
      'Query predicate as a JSON string (alternative to --filter)',
    )
    .option('--limit <n>', 'Maximum results to return', parseInt)
    .option(
      '--fields <list>',
      'Comma-separated fields to include, e.g. metadata.name,metadata.description',
    )
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async opts => {
      const mode = parseOutputFlag(opts.output);

      const query: Record<string, unknown> = {};
      if (opts.kind) query.kind = opts.kind;
      if (opts.type) query['spec.type'] = opts.type;

      let predicate: string | undefined;
      try {
        predicate = resolveJsonInput(opts.filter, opts.filters);
      } catch (error) {
        handleCommandError(error, mode, {
          suggestion:
            'rhdh-cli catalog list --kind Component --filter spec.lifecycle=production',
        });
      }
      // --filter/--filters merge on top of the --kind/--type shortcuts.
      const merged = predicate ? { ...query, ...JSON.parse(predicate) } : query;

      const fields = parseList(opts.fields);

      const flags: Record<string, string | number | undefined> = {
        instance: opts.instance,
        limit: opts.limit,
        fields: fields ? JSON.stringify(fields) : undefined,
      };

      if (Object.keys(merged).length > 0) {
        flags.query = JSON.stringify(merged);
      }

      await runEntityListAction(
        'catalog:query-catalog-entities',
        flags,
        mode,
        'rhdh-cli catalog list --kind Component',
        fields,
      );
    });

  catalog
    .command('get')
    .description('Get a specific catalog entity by name')
    .option('--name <name>', 'Entity name (required)')
    .option('--kind <kind>', 'Entity kind')
    .option('--namespace <ns>', 'Entity namespace (default: default)')
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async opts => {
      const mode = parseOutputFlag(opts.output);
      if (!opts.name) {
        handleCommandError(new Error('--name is required'), mode, {
          suggestion: 'rhdh-cli catalog get --name my-service --kind Component',
        });
      }

      await runRawAction(
        'catalog:get-catalog-entity',
        {
          name: opts.name,
          kind: opts.kind,
          namespace: opts.namespace,
          instance: opts.instance,
        },
        mode,
        'rhdh-cli catalog list --kind Component',
      );
    });

  catalog
    .command('validate')
    .description('Validate entity YAML against the catalog schema')
    .option('--entity <yaml>', 'Entity YAML content')
    .option(
      '--entity-file <path>',
      'Path to a file containing entity YAML (alternative to --entity)',
    )
    .option('--location <url>', 'Location to validate')
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async opts => {
      const mode = parseOutputFlag(opts.output);

      let entity: string | undefined = opts.entity;
      if (opts.entityFile) {
        try {
          entity = readFileSync(opts.entityFile, 'utf-8');
        } catch (error) {
          handleCommandError(error, mode, {
            suggestion: `Check that the file exists: ${opts.entityFile}`,
          });
        }
      }

      if (!entity) {
        handleCommandError(
          new Error('--entity or --entity-file is required'),
          mode,
          {
            suggestion:
              'rhdh-cli catalog validate --entity-file ./catalog-info.yaml',
          },
        );
      }

      await runRawAction(
        'catalog:validate-entity',
        {
          entity,
          location: opts.location,
          instance: opts.instance,
        },
        mode,
      );
    });

  catalog
    .command('register')
    .description('Register a catalog entity from a location URL')
    .option('--location-url <url>', 'Location URL to register (required)')
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async opts => {
      const mode = parseOutputFlag(opts.output);
      if (!opts.locationUrl) {
        handleCommandError(new Error('--location-url is required'), mode, {
          suggestion:
            'rhdh-cli catalog register --location-url https://github.com/org/repo/blob/main/catalog-info.yaml',
        });
      }

      await runRawAction(
        'catalog:register-entity',
        {
          locationUrl: opts.locationUrl,
          instance: opts.instance,
        },
        mode,
      );
    });

  catalog
    .command('unregister')
    .description('Unregister a catalog entity by location')
    .option('--location-id <id>', 'Location ID to unregister')
    .option('--location-url <url>', 'Location URL to unregister')
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async opts => {
      const mode = parseOutputFlag(opts.output);
      if (!opts.locationId && !opts.locationUrl) {
        handleCommandError(
          new Error('--location-id or --location-url is required'),
          mode,
          { suggestion: 'rhdh-cli catalog unregister --location-id <id>' },
        );
      }

      const type: Record<string, string> = {};
      if (opts.locationId) type.locationId = opts.locationId;
      if (opts.locationUrl) type.locationUrl = opts.locationUrl;

      await runRawAction(
        'catalog:unregister-entity',
        {
          type: JSON.stringify(type),
          instance: opts.instance,
        },
        mode,
      );
    });
}

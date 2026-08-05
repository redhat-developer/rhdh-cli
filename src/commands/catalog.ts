import { Command } from 'commander';
import { runEntityListAction, runRawAction } from '../lib/command-helpers';
import { parseOutputFlag } from '../lib/format';
import { handleCommandError } from '../lib/intent-errors';

export function registerCatalogCommands(program: Command) {
  const catalog = program
    .command('catalog')
    .description('Query and manage the Backstage software catalog');

  catalog
    .command('list')
    .description('List catalog entities')
    .option('--kind <kind>', 'Entity kind (Component, API, System, etc.)')
    .option('--type <type>', 'Entity type (service, website, library, etc.)')
    .option('--filter <json>', 'Full query predicate (JSON)')
    .option('--limit <n>', 'Maximum results to return', parseInt)
    .option('--fields <json>', 'Fields to include (JSON array)')
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async opts => {
      const mode = parseOutputFlag(opts.output);

      const query: Record<string, unknown> = {};
      if (opts.kind) query.kind = opts.kind;
      if (opts.type) query['spec.type'] = opts.type;

      const flags: Record<string, string | number | undefined> = {
        instance: opts.instance,
        limit: opts.limit,
        fields: opts.fields,
      };

      if (opts.filter) {
        flags.query = opts.filter;
      } else if (Object.keys(query).length > 0) {
        flags.query = JSON.stringify(query);
      }

      await runEntityListAction(
        'catalog:query-catalog-entities',
        flags,
        mode,
        'rhdh-cli catalog list --kind Component',
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
    .option('--entity <yaml>', 'Entity YAML content (required)')
    .option('--location <url>', 'Location to validate')
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async opts => {
      const mode = parseOutputFlag(opts.output);
      if (!opts.entity) {
        handleCommandError(
          new Error('--entity is required (YAML string)'),
          mode,
          {
            suggestion:
              'rhdh-cli catalog validate --entity "$(cat entity.yaml)"',
          },
        );
      }

      await runRawAction(
        'catalog:validate-entity',
        {
          entity: opts.entity,
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

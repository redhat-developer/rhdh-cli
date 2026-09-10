import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import {
  runEntityListAction,
  runRawAction,
  resolveEntityWithAmbiguityCheck,
  type ActionFlags,
} from './helpers';
import { parseOutputFlag } from './format';
import { handleCommandError } from './intent-errors';
import { collect, resolveJsonInput } from './kv';

export function registerTemplateCommands(program: Command) {
  const template = program
    .command('template')
    .description('List and execute software templates');

  template
    .command('list')
    .description('List available software templates')
    .option(
      '--filter <key=value>',
      'Query predicate, e.g. --filter metadata.tags=nodejs (repeatable)',
      collect,
      [] as string[],
    )
    .option('--limit <n>', 'Maximum results to return', parseInt)
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async opts => {
      const mode = parseOutputFlag(opts.output);

      const query: Record<string, unknown> = { kind: 'Template' };

      let predicate: string | undefined;
      try {
        predicate = resolveJsonInput(opts.filter);
      } catch (error) {
        handleCommandError(error, mode, {
          suggestion: 'rhdh-cli template list --filter metadata.tags=nodejs',
        });
      }
      // --filter flags merge on top of the kind=Template query.
      const merged = predicate ? { ...query, ...JSON.parse(predicate) } : query;

      const flags: ActionFlags = {
        query: JSON.stringify(merged),
        instance: opts.instance,
        limit: opts.limit,
      };

      await runEntityListAction('catalog:query-catalog-entities', flags, mode);
    });

  template
    .command('execute <ref>')
    .description('Execute a software template')
    .option('--namespace <ns>', 'Template namespace (to filter/disambiguate)')
    .option(
      '--value <key=value>',
      'Template input value, e.g. --value name=my-app (repeatable)',
      collect,
      [] as string[],
    )
    .option(
      '--secret <key=value>',
      'Template secret, e.g. --secret token=abc (repeatable)',
      collect,
      [] as string[],
    )
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async (ref: string, opts) => {
      const mode = parseOutputFlag(opts.output);

      try {
        // Templates default to kind=template if not specified
        const { namespace, name } = await resolveEntityWithAmbiguityCheck(ref, {
          defaultKind: 'template',
          namespaceFlag: opts.namespace,
          instance: opts.instance,
        });

        // Build the canonical template reference
        const templateRef = `template:${namespace}/${name}`;

        // Values are optional - some templates accept no parameters
        let values: string | undefined;
        try {
          values = resolveJsonInput(opts.value);
        } catch (error) {
          handleCommandError(error, mode, {
            suggestion:
              'rhdh-cli template execute my-template --value key=value --value otherKey=otherValue',
          });
        }

        let secrets: string | undefined;
        try {
          secrets = resolveJsonInput(opts.secret);
        } catch (error) {
          handleCommandError(error, mode, {
            suggestion:
              'rhdh-cli template execute my-template --secret token=abc',
          });
        }

        await runRawAction(
          'scaffolder:execute-template',
          {
            templateRef,
            values,
            secrets,
            instance: opts.instance,
          },
          mode,
          'rhdh-cli template list',
        );
      } catch (error) {
        handleCommandError(error, mode, {
          suggestion: 'rhdh-cli template execute my-template',
        });
      }
    });

  template
    .command('dry-run')
    .description('Validate a software template without making changes')
    .option('--template-file <path>', 'Path to a template YAML file (required)')
    .option(
      '--value <key=value>',
      'Template input value, e.g. --value name=my-app (repeatable)',
      collect,
      [] as string[],
    )
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async opts => {
      const mode = parseOutputFlag(opts.output);

      if (!opts.templateFile) {
        handleCommandError(new Error('--template-file is required'), mode, {
          suggestion:
            'rhdh-cli template dry-run --template-file ./template.yaml --value name=my-app',
        });
      }

      // Values are optional - some templates accept no parameters
      let values: string | undefined;
      try {
        values = resolveJsonInput(opts.value);
      } catch (error) {
        handleCommandError(error, mode, {
          suggestion:
            'rhdh-cli template dry-run --template-file ./template.yaml --value key=value',
        });
      }

      // scaffolder:dry-run-template expects the raw YAML content of the
      // template (it yaml.parse()s this into apiVersion/kind/spec.steps),
      // not an entity ref, so we read the file here rather than passing
      // through a ref like the other template subcommands.
      let templateYaml: string;
      try {
        templateYaml = readFileSync(opts.templateFile, 'utf-8');
      } catch (error) {
        handleCommandError(error, mode, {
          suggestion: `Check that the file exists: ${opts.templateFile}`,
        });
      }

      await runRawAction(
        'scaffolder:dry-run-template',
        {
          templateYaml,
          values,
          instance: opts.instance,
        },
        mode,
        'rhdh-cli template list',
      );
    });
}

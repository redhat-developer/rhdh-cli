import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { runEntityListAction, runRawAction } from './helpers';
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
    .option('--limit <n>', 'Maximum results to return', parseInt)
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async opts => {
      const mode = parseOutputFlag(opts.output);

      const flags: Record<string, string | number | undefined> = {
        query: JSON.stringify({ kind: 'Template' }),
        instance: opts.instance,
        limit: opts.limit,
      };

      await runEntityListAction('catalog:query-catalog-entities', flags, mode);
    });

  template
    .command('execute')
    .description('Execute a software template')
    .option(
      '--template-ref <ref>',
      'Template entity ref, e.g. template:default/my-template (required)',
    )
    .option(
      '--value <key=value>',
      'Template input value, e.g. --value name=my-app (repeatable)',
      collect,
      [] as string[],
    )
    .option(
      '--values <json>',
      'Template input values as a JSON string (alternative to --value)',
    )
    .option(
      '--secret <key=value>',
      'Template secret, e.g. --secret token=abc (repeatable)',
      collect,
      [] as string[],
    )
    .option(
      '--secrets <json>',
      'Template secrets as a JSON string (alternative to --secret)',
    )
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async opts => {
      const mode = parseOutputFlag(opts.output);

      if (!opts.templateRef) {
        handleCommandError(new Error('--template-ref is required'), mode, {
          suggestion:
            'rhdh-cli template execute --template-ref template:default/my-template --value name=my-app',
        });
      }

      let values: string | undefined;
      try {
        values = resolveJsonInput(opts.value, opts.values);
      } catch (error) {
        handleCommandError(error, mode, {
          suggestion:
            'rhdh-cli template execute --template-ref <ref> --value key=value --value otherKey=otherValue',
        });
      }

      if (!values) {
        handleCommandError(
          new Error('--value (or --values) is required'),
          mode,
          {
            suggestion:
              'rhdh-cli template execute --template-ref <ref> --value key=value',
          },
        );
      }

      let secrets: string | undefined;
      try {
        secrets = resolveJsonInput(opts.secret, opts.secrets);
      } catch (error) {
        handleCommandError(error, mode, {
          suggestion:
            'rhdh-cli template execute --template-ref <ref> --secret token=abc',
        });
      }

      await runRawAction(
        'scaffolder:execute-template',
        {
          templateRef: opts.templateRef,
          values,
          secrets,
          instance: opts.instance,
        },
        mode,
        'rhdh-cli template list',
      );
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
    .option(
      '--values <json>',
      'Template input values as a JSON string (alternative to --value)',
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

      let values: string | undefined;
      try {
        values = resolveJsonInput(opts.value, opts.values);
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

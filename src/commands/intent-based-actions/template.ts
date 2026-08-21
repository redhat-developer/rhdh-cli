import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { runEntityListAction, runRawAction } from './helpers';
import { parseOutputFlag } from './format';
import { handleCommandError } from './intent-errors';

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
    .option('--values <json>', 'Template input values (JSON string, required)')
    .option('--secrets <json>', 'Template secrets (JSON string)')
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async opts => {
      const mode = parseOutputFlag(opts.output);

      if (!opts.templateRef) {
        handleCommandError(new Error('--template-ref is required'), mode, {
          suggestion:
            'rhdh-cli template execute --template-ref template:default/my-template --values \'{"name":"my-app"}\'',
        });
      }

      if (!opts.values) {
        handleCommandError(new Error('--values is required'), mode, {
          suggestion:
            'rhdh-cli template execute --template-ref <ref> --values \'{"key":"value"}\'',
        });
      }

      await runRawAction(
        'scaffolder:execute-template',
        {
          templateRef: opts.templateRef,
          values: opts.values,
          secrets: opts.secrets,
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
    .option('--values <json>', 'Template input values (JSON string)')
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async opts => {
      const mode = parseOutputFlag(opts.output);

      if (!opts.templateFile) {
        handleCommandError(new Error('--template-file is required'), mode, {
          suggestion:
            'rhdh-cli template dry-run --template-file ./template.yaml',
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
          values: opts.values,
          instance: opts.instance,
        },
        mode,
        'rhdh-cli template list',
      );
    });
}

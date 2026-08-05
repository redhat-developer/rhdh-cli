import { Command } from 'commander';
import { runEntityListAction, runRawAction } from '../lib/command-helpers';
import { parseOutputFlag } from '../lib/format';
import { handleCommandError } from '../lib/intent-errors';

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
    .option(
      '--template-ref <ref>',
      'Template entity ref, e.g. template:default/my-template (required)',
    )
    .option('--values <json>', 'Template input values (JSON string)')
    .option('--output <format>', 'Output format: human (default), json')
    .option('--instance <name>', 'Backstage instance name')
    .action(async opts => {
      const mode = parseOutputFlag(opts.output);

      if (!opts.templateRef) {
        handleCommandError(new Error('--template-ref is required'), mode, {
          suggestion:
            'rhdh-cli template dry-run --template-ref template:default/my-template',
        });
      }

      await runRawAction(
        'scaffolder:dry-run-template',
        {
          templateYaml: opts.templateRef,
          values: opts.values,
          instance: opts.instance,
        },
        mode,
        'rhdh-cli template list',
      );
    });
}

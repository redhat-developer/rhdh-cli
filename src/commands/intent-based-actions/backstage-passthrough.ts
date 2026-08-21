import { Command } from 'commander';
import { execPassthrough } from './client';

// Registers a subcommand that simply forwards all its arguments (including
// `-h`/`--help`) to the underlying `backstage-cli` invocation, e.g.
// `rhdh-cli auth login <args>` becomes `backstage-cli auth login <args>`.
function registerPassthroughCommand(
  parent: Command,
  name: string,
  description: string,
  passthroughArgs: string[],
) {
  parent
    .command(name)
    .description(description)
    .allowUnknownOption()
    .helpOption(false)
    .action(function passthroughAction(this: Command) {
      execPassthrough([...passthroughArgs, ...this.args]);
    });
}

export function registerAuthCommands(program: Command) {
  const auth = program
    .command('auth')
    .description('Manage authentication to Backstage/RHDH instances');

  registerPassthroughCommand(
    auth,
    'login',
    'Log in to a Backstage/RHDH instance',
    ['auth', 'login'],
  );
  registerPassthroughCommand(
    auth,
    'logout',
    'Log out and clear stored credentials',
    ['auth', 'logout'],
  );
  registerPassthroughCommand(
    auth,
    'show',
    'Show details of an authenticated instance',
    ['auth', 'show'],
  );
  registerPassthroughCommand(auth, 'list', 'List authenticated instances', [
    'auth',
    'list',
  ]);
  registerPassthroughCommand(auth, 'select', 'Select the default instance', [
    'auth',
    'select',
  ]);
  registerPassthroughCommand(
    auth,
    'print-token',
    'Print an access token to stdout',
    ['auth', 'print-token'],
  );
}

export function registerActionsCommands(program: Command) {
  const actions = program
    .command('actions')
    .description('List and execute Backstage actions');

  registerPassthroughCommand(
    actions,
    'list',
    'List available actions from configured plugin sources',
    ['actions', 'list'],
  );
  registerPassthroughCommand(actions, 'execute', 'Execute an action', [
    'actions',
    'execute',
  ]);

  const sources = actions
    .command('sources')
    .description('Manage plugin sources for action discovery');

  registerPassthroughCommand(
    sources,
    'add',
    'Add plugin source(s) for action discovery',
    ['actions', 'sources', 'add'],
  );
  registerPassthroughCommand(
    sources,
    'list',
    'List configured plugin sources',
    ['actions', 'sources', 'list'],
  );
  registerPassthroughCommand(sources, 'remove', 'Remove plugin source(s)', [
    'actions',
    'sources',
    'remove',
  ]);
}

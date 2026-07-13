import { Command } from 'commander';
import { execPassthrough } from '../lib/client';

export function registerAuthCommands(program: Command) {
  const auth = program
    .command('auth')
    .description('Manage authentication to Backstage/RHDH instances');

  auth
    .command('login')
    .description('Log in to a Backstage/RHDH instance')
    .allowUnknownOption()
    .action(function (this: Command) {
      execPassthrough(['auth', 'login', ...this.args]);
    });

  auth
    .command('logout')
    .description('Log out and clear stored credentials')
    .allowUnknownOption()
    .action(function (this: Command) {
      execPassthrough(['auth', 'logout', ...this.args]);
    });

  auth
    .command('show')
    .description('Show details of an authenticated instance')
    .allowUnknownOption()
    .action(function (this: Command) {
      execPassthrough(['auth', 'show', ...this.args]);
    });

  auth
    .command('list')
    .description('List authenticated instances')
    .allowUnknownOption()
    .action(function (this: Command) {
      execPassthrough(['auth', 'list', ...this.args]);
    });

  auth
    .command('select')
    .description('Select the default instance')
    .allowUnknownOption()
    .action(function (this: Command) {
      execPassthrough(['auth', 'select', ...this.args]);
    });

  auth
    .command('print-token')
    .description('Print an access token to stdout')
    .allowUnknownOption()
    .action(function (this: Command) {
      execPassthrough(['auth', 'print-token', ...this.args]);
    });
}

export function registerActionsCommands(program: Command) {
  const actions = program
    .command('actions')
    .description('List and execute Backstage actions');

  actions
    .command('list')
    .description('List available actions from configured plugin sources')
    .allowUnknownOption()
    .action(function (this: Command) {
      execPassthrough(['actions', 'list', ...this.args]);
    });

  actions
    .command('execute')
    .description('Execute an action')
    .allowUnknownOption()
    .action(function (this: Command) {
      execPassthrough(['actions', 'execute', ...this.args]);
    });

  const sources = actions
    .command('sources')
    .description('Manage plugin sources for action discovery');

  sources
    .command('add')
    .description('Add plugin source(s) for action discovery')
    .allowUnknownOption()
    .action(function (this: Command) {
      execPassthrough(['actions', 'sources', 'add', ...this.args]);
    });

  sources
    .command('list')
    .description('List configured plugin sources')
    .allowUnknownOption()
    .action(function (this: Command) {
      execPassthrough(['actions', 'sources', 'list', ...this.args]);
    });

  sources
    .command('remove')
    .description('Remove plugin source(s)')
    .allowUnknownOption()
    .action(function (this: Command) {
      execPassthrough(['actions', 'sources', 'remove', ...this.args]);
    });
}

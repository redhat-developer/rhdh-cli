import { Command } from 'commander';
import {
  registerAuthCommands,
  registerActionsCommands,
} from './backstage-passthrough';
import { registerCatalogCommands } from './catalog';
import { registerApiCommands } from './api';
import { registerSearchCommands } from './search';
import { registerDocsCommands } from './docs';
import { registerTemplateCommands } from './template';

// Registers the intent-based CLI surface: Backstage CLI pass-through
// commands (auth, actions, sources) plus the higher-level intent commands
// (catalog, api, search, docs, template) that wrap `actions execute` calls.
export function registerIntentCommands(program: Command) {
  registerAuthCommands(program);
  registerActionsCommands(program);

  registerCatalogCommands(program);
  registerApiCommands(program);
  registerSearchCommands(program);
  registerDocsCommands(program);
  registerTemplateCommands(program);
}

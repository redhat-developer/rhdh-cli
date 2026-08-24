import { Command } from 'commander';
import {
  registerAuthCommands,
  registerActionsCommands,
} from './backstage-passthrough';

// Registers Backstage CLI pass-through commands (auth, actions, sources).
export function registerIntentCommands(program: Command) {
  registerAuthCommands(program);
  registerActionsCommands(program);
}

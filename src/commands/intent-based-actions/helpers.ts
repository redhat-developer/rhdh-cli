import { execAction, execActionJson } from './client';
import {
  extractEntities,
  formatEntityTable,
  formatSearchResults,
  OutputMode,
  writeOutput,
} from './format';
import { handleCommandError } from './intent-errors';

type ActionFlags = Record<string, string | boolean | number | undefined>;

/**
 * Runs a catalog-style action that returns a list of entities, and prints
 * them either as JSON (raw action output) or as a human-readable table.
 * Shared by `catalog list`, `api list`, `template list`, and `docs list`.
 * When `fields` is given, the human table shows exactly those columns.
 */
export async function runEntityListAction(
  actionId: string,
  flags: ActionFlags,
  mode: OutputMode,
  suggestion?: string,
  fields?: string[],
): Promise<void> {
  try {
    if (mode === 'json') {
      process.stdout.write(await execAction(actionId, flags));
    } else {
      const result = await execActionJson(actionId, flags);
      writeOutput(extractEntities(result), mode, data =>
        formatEntityTable(data as Array<Record<string, unknown>>, fields),
      );
    }
  } catch (error) {
    handleCommandError(error, mode, suggestion ? { suggestion } : undefined);
  }
}

/**
 * Runs an action whose raw output is a JSON string, and prints it either
 * as-is (JSON mode) or pretty-printed (human mode). Shared by several
 * `catalog` and `template` subcommands.
 */
export async function runRawAction(
  actionId: string,
  flags: ActionFlags,
  mode: OutputMode,
  suggestion?: string,
): Promise<void> {
  try {
    const raw = await execAction(actionId, flags);
    if (mode === 'json') {
      process.stdout.write(raw);
    } else {
      writeOutput(JSON.parse(raw), mode);
    }
  } catch (error) {
    handleCommandError(error, mode, suggestion ? { suggestion } : undefined);
  }
}

/**
 * Runs a `search:query` action and prints the results either as JSON or as
 * human-readable search result snippets. Shared by `search` and `docs
 * search`, which only differ in the extra flags they pass along.
 */
export async function runSearchAction(
  term: string,
  extraFlags: ActionFlags,
  mode: OutputMode,
  suggestion?: string,
): Promise<void> {
  try {
    const flags: ActionFlags = { term, ...extraFlags };

    if (mode === 'json') {
      process.stdout.write(await execAction('search:query', flags));
    } else {
      const result = (await execActionJson('search:query', flags)) as Record<
        string,
        unknown
      >;
      const results = (result?.results ?? result) as Array<
        Record<string, unknown>
      >;
      writeOutput(Array.isArray(results) ? results : result, mode, data =>
        formatSearchResults(data as Array<Record<string, unknown>>),
      );
    }
  } catch (error) {
    handleCommandError(error, mode, suggestion ? { suggestion } : undefined);
  }
}

import { execAction, execActionJson } from './client';
import {
  extractEntities,
  formatEntityTable,
  formatSearchResults,
  OutputMode,
  writeOutput,
} from './format';
import { handleCommandError } from './intent-errors';
import { parseEntityRef } from './kv';

export type ActionFlags = Record<string, string | boolean | number | undefined>;

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
      const result = await execActionJson('search:query', flags);
      let results: unknown;
      if (Array.isArray(result)) {
        results = result;
      } else if (result && typeof result === 'object' && 'results' in result) {
        results = result.results;
      }

      if (Array.isArray(results)) {
        writeOutput(results, mode, data =>
          formatSearchResults(data as Array<Record<string, unknown>>),
        );
      } else {
        writeOutput(result, mode);
      }
    }
  } catch (error) {
    handleCommandError(error, mode, suggestion ? { suggestion } : undefined);
  }
}

/**
 * Resolves an entity reference with ambiguity detection.
 *
 * If the reference is a full reference (kind:namespace/name), returns it directly.
 * If the reference is a short name or partial reference, queries the catalog to find all matching entities.
 * - If exactly 1 match: returns that entity's full reference
 * - If 0 matches: throws "not found" error
 * - If > 1 matches: throws ambiguity error with list of all matches
 *
 * @param ref - Entity reference string ([kind:][namespace/]name)
 * @param options - Optional kind/namespace overrides and instance
 * @returns Resolved entity reference with kind, namespace, and name
 */
export async function resolveEntityWithAmbiguityCheck(
  ref: string,
  options: {
    kindFlag?: string;
    namespaceFlag?: string;
    defaultKind?: string;
    instance?: string;
  } = {},
): Promise<{
  kind: string;
  namespace: string;
  name: string;
  entityRef: string;
}> {
  const parsed = parseEntityRef(ref);

  // Determine kind and namespace from flags, parsed values, or defaults
  const kind = options.kindFlag || parsed.kind || options.defaultKind;
  const namespace = options.namespaceFlag || parsed.namespace;
  const name = parsed.name;

  // If we have full reference (kind and namespace specified), return directly
  if (kind && namespace) {
    return {
      kind,
      namespace,
      name,
      entityRef: `${kind}:${namespace}/${name}`,
    };
  }

  // Query catalog for all entities with this name
  const query: Record<string, unknown> = { 'metadata.name': name };

  // If kind is specified but namespace is not, filter by kind
  if (kind) {
    query.kind = kind;
  }

  // If namespace is specified but kind is not, filter by namespace
  if (namespace) {
    query['metadata.namespace'] = namespace;
  }

  const flags: ActionFlags = {
    query: JSON.stringify(query),
    instance: options.instance,
  };

  const result = await execActionJson('catalog:query-catalog-entities', flags);
  const entities = extractEntities(result);

  // Handle results
  if (entities.length === 0) {
    let refStr = name;
    if (kind) {
      refStr = namespace ? `${kind}:${namespace}/${name}` : `${kind}:*/${name}`;
    } else if (namespace) {
      refStr = `*:${namespace}/${name}`;
    }
    throw new Error(`Entity not found: ${refStr}`);
  }

  if (entities.length === 1) {
    const entity = entities[0] as Record<string, unknown>;
    const metadata = entity.metadata as Record<string, unknown>;
    const entityKind = String(entity.kind || 'unknown');
    const entityNamespace = String(metadata.namespace || 'default');
    const entityName = String(metadata.name || name);

    return {
      kind: entityKind,
      namespace: entityNamespace,
      name: entityName,
      entityRef: `${entityKind}:${entityNamespace}/${entityName}`,
    };
  }

  // Multiple matches - build error with all matching references
  const matches = entities.map((e: unknown) => {
    const entity = e as Record<string, unknown>;
    const metadata = entity.metadata as Record<string, unknown>;
    const entityKind = String(entity.kind || 'unknown');
    const entityNamespace = String(metadata.namespace || 'default');
    const entityName = String(metadata.name || name);
    return `${entityKind}:${entityNamespace}/${entityName}`;
  });

  throw new Error(
    `Ambiguous entity reference. Multiple entities named "${name}" found:\n  ${matches.join('\n  ')}\n\nUse full reference to disambiguate.`,
  );
}

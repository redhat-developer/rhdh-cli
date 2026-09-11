/**
 * Commander accumulator for options that can be repeated, e.g.
 * `--value name=my-app --value owner=user:default/jdoe`.
 */
export function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/**
 * Parses repeated "key=value" strings (as gathered via `collect`) into a
 * plain object. Values that look like numbers or booleans are coerced so
 * common template/filter inputs don't have to be quoted as JSON strings.
 */
export function parseKeyValuePairs(
  pairs: string[] | undefined,
): Record<string, unknown> | undefined {
  if (!pairs || pairs.length === 0) return undefined;

  const result: Record<string, unknown> = {};
  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex <= 0) {
      throw new Error(
        `Invalid "key=value" pair: "${pair}" (expected format: key=value)`,
      );
    }
    const key = pair.slice(0, eqIndex);
    result[key] = coerceValue(pair.slice(eqIndex + 1));
  }
  return result;
}

/**
 * Splits a comma-separated list flag (e.g. `--fields
 * metadata.name,metadata.description`) into a trimmed array, dropping empty
 * entries. Returns undefined when nothing usable is given, so callers can
 * omit the underlying action flag entirely.
 */
export function parseList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0);
  return items.length > 0 ? items : undefined;
}

function coerceValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

/**
 * Combines repeatable "key=value" pairs with an optional raw JSON string
 * into a single JSON string, so commands can accept either `--value
 * key=value` (repeated) or a `--values`/`--filters` JSON blob, or both at
 * once (pairs win on key conflicts). Returns undefined when neither is set.
 */
export function resolveJsonInput(
  pairs: string[] | undefined,
  json?: string,
): string | undefined {
  const fromPairs = parseKeyValuePairs(pairs);

  if (json) {
    let base: unknown;
    try {
      base = JSON.parse(json);
    } catch {
      throw new Error(`Invalid JSON: "${json}"`);
    }
    if (typeof base !== 'object' || base === null || Array.isArray(base)) {
      throw new Error('JSON input must be an object');
    }
    return JSON.stringify({
      ...(base as Record<string, unknown>),
      ...fromPairs,
    });
  }

  return fromPairs ? JSON.stringify(fromPairs) : undefined;
}

/**
 * Parses an entity reference in the format [kind:][namespace/]name
 * and returns the parsed components.
 *
 * Examples:
 * - "my-service" -> {name: "my-service"}
 * - "default/my-service" -> {namespace: "default", name: "my-service"}
 * - "component:default/my-service" -> {kind: "component", namespace: "default", name: "my-service"}
 */
export function parseEntityRef(ref: string): {
  kind?: string;
  namespace?: string;
  name: string;
} {
  if (!ref || ref.trim() === '') {
    throw new Error('Entity reference cannot be empty');
  }

  // Check for full format: kind:namespace/name
  const colonIndex = ref.indexOf(':');
  if (colonIndex > 0) {
    const kind = ref.slice(0, colonIndex);
    const remainder = ref.slice(colonIndex + 1);
    const slashIndex = remainder.indexOf('/');

    if (slashIndex > 0) {
      // kind:namespace/name
      return {
        kind,
        namespace: remainder.slice(0, slashIndex),
        name: remainder.slice(slashIndex + 1),
      };
    }

    // kind:name (no namespace)
    return {
      kind,
      name: remainder,
    };
  }

  // Check for namespace/name format
  const slashIndex = ref.indexOf('/');
  if (slashIndex > 0) {
    return {
      namespace: ref.slice(0, slashIndex),
      name: ref.slice(slashIndex + 1),
    };
  }

  // Just a name
  return {
    name: ref,
  };
}

/**
 * Resolves an entity reference from a positional argument,
 * with optional kind and namespace overrides or defaults.
 *
 * @param ref - Required positional entity reference
 * @param defaultKind - Default kind if not specified in ref (e.g., 'template', 'api')
 * @param kindFlag - Optional --kind flag to override or disambiguate
 * @param namespaceFlag - Optional --namespace flag to override or disambiguate
 * @param requireKind - If true, throws error if kind is not specified
 */
export function resolveEntityRef(
  ref: string,
  options: {
    defaultKind?: string;
    kindFlag?: string;
    namespaceFlag?: string;
    requireKind?: boolean;
  } = {},
): {
  kind?: string;
  namespace: string;
  name: string;
  entityRef: string;
} {
  const parsed = parseEntityRef(ref);

  // Determine kind: flag > parsed > default
  const kind = options.kindFlag || parsed.kind || options.defaultKind;

  // Determine namespace: flag > parsed > 'default'
  const namespace = options.namespaceFlag || parsed.namespace || 'default';
  const name = parsed.name;

  // Validate kind requirement
  if (options.requireKind && !kind) {
    throw new Error(
      `Entity kind is required. Provide full reference (e.g., component:default/${name}) or use --kind flag.`,
    );
  }

  // Build the canonical entity reference
  const entityRef = kind
    ? `${kind}:${namespace}/${name}`
    : `${namespace}/${name}`;

  return {
    kind,
    namespace,
    name,
    entityRef,
  };
}

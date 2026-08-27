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
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
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
  json: string | undefined,
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

import chalk from 'chalk';

export type OutputMode = 'human' | 'json';

export function parseOutputFlag(output: string | undefined): OutputMode {
  if (output === 'json') return 'json';
  return 'human';
}

export function writeOutput(
  data: unknown,
  mode: OutputMode,
  humanFormatter?: (data: unknown) => string,
): void {
  if (mode === 'json') {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }

  if (humanFormatter) {
    process.stdout.write(humanFormatter(data));
    return;
  }

  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

export function formatEntityTable(
  entities: Array<Record<string, unknown>>,
  fields?: string[],
): string {
  if (entities.length === 0) {
    return `${chalk.yellow('No entities found.')}\n`;
  }

  if (fields && fields.length > 0) {
    return formatFieldsTable(entities, fields);
  }

  const lines: string[] = [];
  const header = `${chalk.bold(pad('NAME', 40))} ${chalk.bold(pad('KIND', 16))} ${chalk.bold(pad('NAMESPACE', 16))} ${chalk.bold('TYPE')}`;
  lines.push(header);

  for (const entity of entities) {
    const metadata = entity.metadata as Record<string, unknown> | undefined;
    const spec = entity.spec as Record<string, unknown> | undefined;
    const name = String(metadata?.name ?? entity.name ?? '');
    const kind = String(entity.kind ?? '');
    const namespace = String(
      metadata?.namespace ?? entity.namespace ?? 'default',
    );
    const type = String(spec?.type ?? entity.type ?? '');
    lines.push(
      `${pad(name, 40)} ${pad(kind, 16)} ${pad(namespace, 16)} ${type}`,
    );
  }

  return `${lines.join('\n')}\n`;
}

export function formatSearchResults(
  results: Array<Record<string, unknown>>,
): string {
  if (results.length === 0) {
    return `${chalk.yellow('No results found.')}\n`;
  }

  const lines: string[] = [];
  for (const result of results) {
    const doc = result.document as Record<string, unknown> | undefined;
    const title = String(doc?.title ?? result.title ?? '');
    const location = String(doc?.location ?? result.location ?? '');
    const text = String(doc?.text ?? '');
    const snippet = text.length > 120 ? `${text.slice(0, 120)}...` : text;

    lines.push(`${chalk.bold(title)}`);
    if (location) lines.push(`  ${chalk.dim(location)}`);
    if (snippet) lines.push(`  ${snippet}`);
    lines.push('');
  }

  return lines.join('\n');
}

// Renders a table with one column per requested field (e.g. `--fields
// metadata.name,metadata.description`), so the human output reflects exactly
// what the user asked for instead of the fixed NAME/KIND/NAMESPACE/TYPE set.
function formatFieldsTable(
  entities: Array<Record<string, unknown>>,
  fields: string[],
): string {
  const headers = fields.map(field =>
    (field.split('.').pop() ?? field).toUpperCase(),
  );
  const rows = entities.map(entity =>
    fields.map(field => formatCell(getByPath(entity, field))),
  );
  const widths = fields.map((_, col) =>
    Math.max(headers[col].length, ...rows.map(row => row[col].length)),
  );

  const renderRow = (cells: string[]): string =>
    cells
      // The last column is left unpadded to avoid trailing whitespace.
      .map((cell, col) =>
        col === cells.length - 1 ? cell : pad(cell, widths[col]),
      )
      .join(' ');

  const lines = [
    renderRow(headers.map((h, col) => chalk.bold(pad(h, widths[col])))),
    ...rows.map(renderRow),
  ];
  return `${lines.join('\n')}\n`;
}

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function formatCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function pad(str: string, width: number): string {
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
}

export function extractEntities(
  result: unknown,
): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result;
  const obj = result as Record<string, unknown> | undefined;
  return (obj?.items ?? obj?.entities ?? []) as Array<Record<string, unknown>>;
}

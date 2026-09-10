import chalk from 'chalk';
import type { OutputMode } from './format';

export interface CliError {
  error: string;
  reason: string;
  suggestion?: string;
}

export function formatError(err: CliError, mode: OutputMode): string {
  if (mode === 'json') {
    return `${JSON.stringify(err, null, 2)}\n`;
  }

  const lines = [`${chalk.red('Error:')} ${err.error}`];

  const normalizedError = err.error.replace(/^Error:\s*/i, '').trim();
  const normalizedReason = err.reason.replace(/^Error:\s*/i, '').trim();
  if (normalizedReason && normalizedReason !== normalizedError) {
    lines.push('', normalizedReason);
  }

  if (err.suggestion) {
    lines.push('', `${chalk.dim('Try:')}`, `  ${err.suggestion}`);
  }

  return `${lines.join('\n')}\n`;
}

export function handleCommandError(
  error: unknown,
  mode: OutputMode,
  context?: { suggestion?: string },
): never {
  const message = extractPrimaryMessage(error);

  const cliError: CliError = {
    error: message,
    reason: extractReason(error),
  };
  if (context?.suggestion) {
    cliError.suggestion = context.suggestion;
  }

  process.stderr.write(formatError(cliError, mode));
  process.exit(1);
}

function getStderr(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('stderr' in error)) {
    return undefined;
  }
  const { stderr } = error as { stderr: unknown };
  return typeof stderr === 'string' ? stderr : undefined;
}

function extractReason(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown error';

  const fullMessage = collectMessages(error);

  if (hasStatusCode(fullMessage, 401) || fullMessage.includes('Unauthorized')) {
    return 'Authentication failed or token expired. Re-authenticate with: rhdh-cli auth login';
  }
  if (hasStatusCode(fullMessage, 404) || fullMessage.includes('Not Found')) {
    return 'The requested resource was not found. Check the entity name, kind, or namespace.';
  }
  if (
    fullMessage.includes('ECONNREFUSED') ||
    fullMessage.includes('fetch failed')
  ) {
    return 'Could not connect to the RHDH instance. Check that the instance is running and reachable.';
  }
  if (fullMessage.includes('No authenticated instances')) {
    return 'No RHDH instance configured. Run: rhdh-cli auth login --rhdh-url <URL>';
  }

  const stderrMessage = extractStderrMessage(error);
  if (stderrMessage) return stderrMessage;

  return extractPrimaryMessage(error);
}

function hasStatusCode(message: string, statusCode: number): boolean {
  return new RegExp(`(?:^|[\\s:=])${statusCode}(?:$|[\\s,.;])`).test(message);
}

function collectMessages(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    parts.push(current.message);
    current = current.cause;
  }
  return parts.join(' ');
}

function extractPrimaryMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const stderrMessage = extractStderrMessage(error);
  if (stderrMessage) return stderrMessage;

  return error.message;
}

function extractStderrMessage(error: unknown): string | undefined {
  const stderr = getStderr(error);
  if (!stderr || !stderr.trim()) return undefined;

  const lines = stderr
    .trim()
    .split('\n')
    .filter(l => l.trim());
  const errorLine = lines.find(l => /^Error:/i.test(l.trim()));
  return errorLine
    ? errorLine.replace(/^\s*Error:\s*/i, '').trim()
    : lines[0].trim();
}

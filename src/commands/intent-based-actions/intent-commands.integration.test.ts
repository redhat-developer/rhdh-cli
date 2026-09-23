/**
 * Mocked integration tests: real commander + helpers + format/errors,
 * with only `./client` (action execution) mocked. No live RHDH required.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { execAction, execActionJson } from './client';
import { registerApiCommands } from './api';
import { registerCatalogCommands } from './catalog';
import { registerDocsCommands } from './docs';
import { registerSearchCommands } from './search';
import { registerTemplateCommands } from './template';

jest.mock('./client');

const mockExecAction = execAction as jest.MockedFunction<typeof execAction>;
const mockExecActionJson = execActionJson as jest.MockedFunction<
  typeof execActionJson
>;

const SAMPLE_COMPONENT = {
  kind: 'Component',
  metadata: { name: 'payments', namespace: 'default' },
  spec: { type: 'service' },
};

const SAMPLE_API = {
  kind: 'API',
  metadata: { name: 'payments-api', namespace: 'default' },
  spec: {
    type: 'openapi',
    definition: 'openapi: 3.0.0\ninfo:\n  title: Payments\n',
  },
};

const SAMPLE_TEMPLATE = {
  kind: 'Template',
  metadata: { name: 'react-ssr', namespace: 'default' },
  spec: { type: 'website' },
};

function captureIo() {
  const stdout = jest
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  const stderr = jest
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
  const exit = jest
    .spyOn(process, 'exit')
    .mockImplementation((() => undefined) as never);
  return {
    stdout,
    stderr,
    exit,
    restore() {
      stdout.mockRestore();
      stderr.mockRestore();
      exit.mockRestore();
    },
  };
}

async function runCli(
  register: (program: Command) => void,
  args: string[],
): Promise<void> {
  const program = new Command();
  // Avoid commander calling process.exit on its own parse errors.
  program.exitOverride();
  register(program);
  await program.parseAsync(['node', 'test', ...args]);
}

function spyText(spy: jest.SpyInstance): string {
  return spy.mock.calls.map(call => String(call[0] ?? '')).join('');
}

describe('intent commands (mocked client integration)', () => {
  let io: ReturnType<typeof captureIo>;

  beforeEach(() => {
    jest.clearAllMocks();
    io = captureIo();
  });

  afterEach(() => {
    io.restore();
  });

  it('catalog list renders entities (human) and passes through json', async () => {
    mockExecActionJson.mockReturnValue({ items: [SAMPLE_COMPONENT] });
    await runCli(registerCatalogCommands, [
      'catalog',
      'list',
      '--kind',
      'Component',
    ]);
    expect(mockExecActionJson).toHaveBeenCalledWith(
      'catalog:query-catalog-entities',
      expect.objectContaining({
        query: JSON.stringify({ kind: 'Component' }),
        fields: JSON.stringify([
          'metadata.name',
          'kind',
          'metadata.namespace',
          'spec.type',
        ]),
      }),
    );
    expect(spyText(io.stdout)).toContain('payments');
    expect(spyText(io.stdout)).toContain('Component');

    jest.clearAllMocks();
    io.stdout.mockClear();
    mockExecAction.mockReturnValue(
      JSON.stringify({ items: [SAMPLE_COMPONENT] }),
    );
    await runCli(registerCatalogCommands, [
      'catalog',
      'list',
      '--kind',
      'Component',
      '--output',
      'json',
    ]);
    expect(mockExecAction).toHaveBeenCalledWith(
      'catalog:query-catalog-entities',
      expect.objectContaining({
        query: JSON.stringify({ kind: 'Component' }),
        fields: undefined,
      }),
    );
    expect(spyText(io.stdout)).toContain('"items"');
  });

  it('catalog get uses a full ref and prints the entity', async () => {
    mockExecAction.mockReturnValue(JSON.stringify(SAMPLE_COMPONENT));
    await runCli(registerCatalogCommands, [
      'catalog',
      'get',
      'component:default/payments',
    ]);
    expect(mockExecAction).toHaveBeenCalledWith('catalog:get-catalog-entity', {
      name: 'payments',
      kind: 'component',
      namespace: 'default',
      instance: undefined,
    });
    expect(spyText(io.stdout)).toContain('payments');
  });

  it('api list and get-spec extract definitions or error when missing', async () => {
    mockExecActionJson.mockReturnValue({ items: [SAMPLE_API] });
    await runCli(registerApiCommands, ['api', 'list', '--type', 'openapi']);
    expect(mockExecActionJson).toHaveBeenCalledWith(
      'catalog:query-catalog-entities',
      expect.objectContaining({
        query: JSON.stringify({ kind: 'API', 'spec.type': 'openapi' }),
      }),
    );
    expect(spyText(io.stdout)).toContain('payments-api');

    jest.clearAllMocks();
    io.stdout.mockClear();
    mockExecAction.mockReturnValue(JSON.stringify(SAMPLE_API));
    await runCli(registerApiCommands, [
      'api',
      'get-spec',
      'api:default/payments-api',
    ]);
    expect(mockExecAction).toHaveBeenCalledWith('catalog:get-catalog-entity', {
      name: 'payments-api',
      kind: 'API',
      namespace: 'default',
      instance: undefined,
    });
    expect(spyText(io.stdout)).toContain('openapi: 3.0.0');

    jest.clearAllMocks();
    io.stderr.mockClear();
    io.exit.mockClear();
    mockExecAction.mockReturnValue(
      JSON.stringify({
        kind: 'API',
        metadata: { name: 'empty', namespace: 'default' },
        spec: { type: 'openapi' },
      }),
    );
    await runCli(registerApiCommands, ['api', 'get-spec', 'api:default/empty']);
    expect(io.exit).toHaveBeenCalledWith(1);
    expect(spyText(io.stderr)).toMatch(/no spec\.definition/i);
  });

  it('search prints results and surfaces action failures', async () => {
    mockExecActionJson.mockReturnValue({
      results: [
        {
          document: {
            title: 'Payments service',
            location: '/catalog/default/component/payments',
            text: 'Handles payment flows',
          },
        },
      ],
    });
    await runCli(registerSearchCommands, [
      'search',
      'payment',
      '--filter',
      'kind=Component',
    ]);
    expect(mockExecActionJson).toHaveBeenCalledWith(
      'search:query',
      expect.objectContaining({
        term: 'payment',
        filters: JSON.stringify({ kind: 'Component' }),
      }),
    );
    expect(spyText(io.stdout)).toContain('Payments service');

    jest.clearAllMocks();
    io.stderr.mockClear();
    io.exit.mockClear();
    mockExecActionJson.mockImplementation(() => {
      throw new Error('ECONNREFUSED');
    });
    await runCli(registerSearchCommands, ['search', 'payment']);
    expect(io.exit).toHaveBeenCalledWith(1);
    const err = spyText(io.stderr);
    expect(err).toMatch(/Error:/);
    expect(err).toMatch(/connect|ECONNREFUSED/i);
  });

  it('docs search scopes types to techdocs', async () => {
    mockExecActionJson.mockReturnValue({ results: [] });
    await runCli(registerDocsCommands, ['docs', 'search', 'onboarding']);
    expect(mockExecActionJson).toHaveBeenCalledWith(
      'search:query',
      expect.objectContaining({
        term: 'onboarding',
        types: '["techdocs"]',
      }),
    );
    expect(spyText(io.stdout)).toMatch(/No results found/i);
  });

  it('template list/execute/dry-run call scaffolder and catalog actions', async () => {
    mockExecActionJson.mockReturnValue({ items: [SAMPLE_TEMPLATE] });
    await runCli(registerTemplateCommands, ['template', 'list']);
    expect(mockExecActionJson).toHaveBeenCalledWith(
      'catalog:query-catalog-entities',
      expect.objectContaining({
        query: JSON.stringify({ kind: 'Template' }),
      }),
    );
    expect(spyText(io.stdout)).toContain('react-ssr');

    jest.clearAllMocks();
    io.stdout.mockClear();
    mockExecAction.mockReturnValue(JSON.stringify({ id: 'task-1' }));
    await runCli(registerTemplateCommands, [
      'template',
      'execute',
      'template:default/react-ssr',
      '--value',
      'name=demo',
    ]);
    expect(mockExecAction).toHaveBeenCalledWith(
      'scaffolder:execute-template',
      expect.objectContaining({
        templateRef: 'template:default/react-ssr',
        values: JSON.stringify({ name: 'demo' }),
      }),
    );

    jest.clearAllMocks();
    mockExecAction.mockReturnValue(JSON.stringify({ ok: true }));
    const dir = mkdtempSync(join(tmpdir(), 'rhdh-cli-int-tpl-'));
    const templateFile = join(dir, 'template.yaml');
    const yaml =
      'apiVersion: scaffolder.backstage.io/v1beta3\nkind: Template\n';
    writeFileSync(templateFile, yaml);
    await runCli(registerTemplateCommands, [
      'template',
      'dry-run',
      '--template-file',
      templateFile,
    ]);
    expect(mockExecAction).toHaveBeenCalledWith(
      'scaffolder:dry-run-template',
      expect.objectContaining({ templateYaml: yaml }),
    );
  });
});

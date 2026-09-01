import {
  parseOutputFlag,
  writeOutput,
  formatEntityTable,
  formatSearchResults,
  extractEntities,
} from './format';

describe('parseOutputFlag', () => {
  it('returns "json" when output is "json"', () => {
    expect(parseOutputFlag('json')).toBe('json');
  });

  it('returns "human" when output is "human"', () => {
    expect(parseOutputFlag('human')).toBe('human');
  });

  it('returns "human" when output is undefined', () => {
    expect(parseOutputFlag(undefined)).toBe('human');
  });

  it('returns "human" for any unrecognized value', () => {
    expect(parseOutputFlag('yaml')).toBe('human');
  });
});

describe('extractEntities', () => {
  it('returns the array as-is when result is already an array', () => {
    const entities = [{ kind: 'Component' }];
    expect(extractEntities(entities)).toBe(entities);
  });

  it('returns result.items when present', () => {
    const items = [{ kind: 'Component' }];
    expect(extractEntities({ items })).toBe(items);
  });

  it('returns result.entities when items is absent', () => {
    const entities = [{ kind: 'API' }];
    expect(extractEntities({ entities })).toBe(entities);
  });

  it('prefers items over entities when both are present', () => {
    const items = [{ kind: 'Component' }];
    const entities = [{ kind: 'API' }];
    expect(extractEntities({ items, entities })).toBe(items);
  });

  it('returns an empty array when result has neither items nor entities', () => {
    expect(extractEntities({})).toEqual([]);
  });

  it('returns an empty array when result is undefined', () => {
    expect(extractEntities(undefined)).toEqual([]);
  });
});

describe('formatEntityTable', () => {
  it('returns a "no entities" message for an empty list', () => {
    expect(formatEntityTable([])).toMatch(/No entities found\./);
  });

  it('formats an entity using metadata.name/kind/namespace and spec.type', () => {
    const output = formatEntityTable([
      {
        kind: 'Component',
        metadata: { name: 'my-service', namespace: 'default' },
        spec: { type: 'service' },
      },
    ]);
    expect(output).toContain('my-service');
    expect(output).toContain('Component');
    expect(output).toContain('default');
    expect(output).toContain('service');
  });

  it('falls back to top-level name/kind/namespace/type when metadata/spec are absent', () => {
    const output = formatEntityTable([
      { name: 'flat-entity', kind: 'API', namespace: 'custom', type: 'grpc' },
    ]);
    expect(output).toContain('flat-entity');
    expect(output).toContain('API');
    expect(output).toContain('custom');
    expect(output).toContain('grpc');
  });

  it('defaults namespace to "default" when missing everywhere', () => {
    const output = formatEntityTable([{ kind: 'Component', name: 'x' }]);
    expect(output).toContain('default');
  });

  it('includes a header row', () => {
    const output = formatEntityTable([{ kind: 'Component', name: 'x' }]);
    expect(output).toContain('NAME');
    expect(output).toContain('KIND');
    expect(output).toContain('NAMESPACE');
    expect(output).toContain('TYPE');
  });

  it('renders a column per requested field, using the last path segment as the header', () => {
    const output = formatEntityTable(
      [
        {
          kind: 'Component',
          metadata: { name: 'rhdh', description: 'Developer Hub' },
        },
      ],
      ['metadata.name', 'metadata.description'],
    );
    expect(output).toContain('NAME');
    expect(output).toContain('DESCRIPTION');
    expect(output).toContain('rhdh');
    expect(output).toContain('Developer Hub');
  });

  it('omits the default KIND/TYPE columns when explicit fields are requested', () => {
    const output = formatEntityTable(
      [{ kind: 'Component', metadata: { name: 'rhdh' } }],
      ['metadata.name'],
    );
    expect(output).toContain('NAME');
    expect(output).not.toContain('KIND');
    expect(output).not.toContain('TYPE');
  });

  it('renders an empty cell when a requested field is missing on an entity', () => {
    const output = formatEntityTable(
      [{ metadata: { name: 'rhdh' } }],
      ['metadata.name', 'metadata.description'],
    );
    expect(output).toContain('rhdh');
    expect(output).toContain('DESCRIPTION');
  });
});

describe('formatSearchResults', () => {
  it('returns a "no results" message for an empty list', () => {
    expect(formatSearchResults([])).toMatch(/No results found\./);
  });

  it('formats a result using document.title/location/text', () => {
    const output = formatSearchResults([
      {
        document: {
          title: 'Getting started',
          location: '/docs/getting-started',
          text: 'A short guide.',
        },
      },
    ]);
    expect(output).toContain('Getting started');
    expect(output).toContain('/docs/getting-started');
    expect(output).toContain('A short guide.');
  });

  it('falls back to top-level title/location when document is absent', () => {
    const output = formatSearchResults([
      { title: 'Flat result', location: '/flat' },
    ]);
    expect(output).toContain('Flat result');
    expect(output).toContain('/flat');
  });

  it('omits the location line when no location is present', () => {
    const output = formatSearchResults([{ title: 'No location' }]);
    expect(output).toContain('No location');
  });

  it('truncates snippet text longer than 120 characters', () => {
    const longText = 'a'.repeat(200);
    const output = formatSearchResults([
      { document: { title: 't', text: longText } },
    ]);
    expect(output).toContain(`${'a'.repeat(120)}...`);
    expect(output).not.toContain('a'.repeat(121));
  });

  it('does not truncate snippet text at or under 120 characters', () => {
    const shortText = 'a'.repeat(120);
    const output = formatSearchResults([
      { document: { title: 't', text: shortText } },
    ]);
    expect(output).toContain(shortText);
    expect(output).not.toContain('...');
  });
});

describe('writeOutput', () => {
  let writeSpy: jest.SpyInstance;

  beforeEach(() => {
    writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('writes pretty-printed JSON in json mode, ignoring any humanFormatter', () => {
    const data = { foo: 'bar' };
    const humanFormatter = jest.fn();

    writeOutput(data, 'json', humanFormatter);

    expect(writeSpy).toHaveBeenCalledWith(`${JSON.stringify(data, null, 2)}\n`);
    expect(humanFormatter).not.toHaveBeenCalled();
  });

  it('uses the humanFormatter in human mode when provided', () => {
    const data = [{ foo: 'bar' }];
    const humanFormatter = jest.fn().mockReturnValue('formatted output\n');

    writeOutput(data, 'human', humanFormatter);

    expect(humanFormatter).toHaveBeenCalledWith(data);
    expect(writeSpy).toHaveBeenCalledWith('formatted output\n');
  });

  it('falls back to pretty-printed JSON in human mode without a humanFormatter', () => {
    const data = { foo: 'bar' };

    writeOutput(data, 'human');

    expect(writeSpy).toHaveBeenCalledWith(`${JSON.stringify(data, null, 2)}\n`);
  });
});

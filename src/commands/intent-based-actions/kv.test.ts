import { collect, parseKeyValuePairs, parseList, resolveJsonInput } from './kv';

describe('collect', () => {
  it('accumulates values across calls without mutating the previous array', () => {
    const first = collect('a=1', []);
    const second = collect('b=2', first);

    expect(first).toEqual(['a=1']);
    expect(second).toEqual(['a=1', 'b=2']);
  });
});

describe('parseKeyValuePairs', () => {
  it('returns undefined when given no pairs', () => {
    expect(parseKeyValuePairs(undefined)).toBeUndefined();
    expect(parseKeyValuePairs([])).toBeUndefined();
  });

  it('parses simple key=value pairs as strings', () => {
    expect(parseKeyValuePairs(['githubHost=github.com', 'owner=foo'])).toEqual({
      githubHost: 'github.com',
      owner: 'foo',
    });
  });

  it('coerces "true"/"false" to booleans', () => {
    expect(parseKeyValuePairs(['verbose=true', 'dryRun=false'])).toEqual({
      verbose: true,
      dryRun: false,
    });
  });

  it('coerces numeric-looking values to numbers', () => {
    expect(parseKeyValuePairs(['limit=5', 'ratio=0.5'])).toEqual({
      limit: 5,
      ratio: 0.5,
    });
  });

  it('keeps values with embedded "=" intact', () => {
    expect(parseKeyValuePairs(['query=kind=Component'])).toEqual({
      query: 'kind=Component',
    });
  });

  it('keeps entity-ref-style values as strings even though they contain colons', () => {
    expect(parseKeyValuePairs(['componentOwner=user:default/default'])).toEqual(
      { componentOwner: 'user:default/default' },
    );
  });

  it('throws for a pair missing "="', () => {
    expect(() => parseKeyValuePairs(['no-equals-sign'])).toThrow(
      /Invalid "key=value" pair/,
    );
  });

  it('throws for a pair with an empty key', () => {
    expect(() => parseKeyValuePairs(['=value'])).toThrow(
      /Invalid "key=value" pair/,
    );
  });
});

describe('parseList', () => {
  it('returns undefined for undefined, empty, or comma-only input', () => {
    expect(parseList(undefined)).toBeUndefined();
    expect(parseList('')).toBeUndefined();
    expect(parseList('   ')).toBeUndefined();
    expect(parseList(',,')).toBeUndefined();
  });

  it('splits a comma-separated list', () => {
    expect(parseList('metadata.name,metadata.description')).toEqual([
      'metadata.name',
      'metadata.description',
    ]);
  });

  it('trims whitespace around entries and drops empty ones', () => {
    expect(parseList('techdocs, software-catalog ,')).toEqual([
      'techdocs',
      'software-catalog',
    ]);
  });
});

describe('resolveJsonInput', () => {
  it('returns undefined when neither pairs nor json are given', () => {
    expect(resolveJsonInput(undefined, undefined)).toBeUndefined();
    expect(resolveJsonInput([], undefined)).toBeUndefined();
  });

  it('builds a JSON object from key=value pairs alone', () => {
    expect(resolveJsonInput(['kind=Component'], undefined)).toBe(
      JSON.stringify({ kind: 'Component' }),
    );
  });

  it('passes through raw JSON when no pairs are given', () => {
    const json = JSON.stringify({ kind: 'Component' });
    expect(resolveJsonInput([], json)).toBe(json);
  });

  it('merges pairs into the raw JSON object, with pairs taking precedence', () => {
    const json = JSON.stringify({ kind: 'Component', type: 'service' });
    const result = resolveJsonInput(['kind=API'], json);

    expect(JSON.parse(result!)).toEqual({ kind: 'API', type: 'service' });
  });

  it('throws when the raw JSON is invalid', () => {
    expect(() => resolveJsonInput(undefined, '{not valid json')).toThrow(
      /Invalid JSON/,
    );
  });

  it('throws when the raw JSON is not an object', () => {
    expect(() => resolveJsonInput(undefined, '"just a string"')).toThrow(
      /JSON input must be an object/,
    );
    expect(() => resolveJsonInput(undefined, '[1,2,3]')).toThrow(
      /JSON input must be an object/,
    );
  });
});

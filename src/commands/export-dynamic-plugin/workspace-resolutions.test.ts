import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

import {
  customizeForDynamicUse,
  filterWorkspaceResolutionsForDynamicExport,
  shouldOmitWorkspaceResolutionValue,
} from './common-utils';

describe('shouldOmitWorkspaceResolutionValue', () => {
  it('omits monorepo protocol strings and nested values', () => {
    expect(shouldOmitWorkspaceResolutionValue('workspace:*')).toBe(true);
    expect(shouldOmitWorkspaceResolutionValue('  portal:../x')).toBe(true);
    expect(shouldOmitWorkspaceResolutionValue('link:./foo')).toBe(true);
    expect(shouldOmitWorkspaceResolutionValue({ a: 1 })).toBe(true);
    expect(shouldOmitWorkspaceResolutionValue([1])).toBe(true);
  });

  it('keeps semver, npm, patch, file, and scalars', () => {
    expect(shouldOmitWorkspaceResolutionValue('1.2.3')).toBe(false);
    expect(shouldOmitWorkspaceResolutionValue('npm:foo@1')).toBe(false);
    expect(shouldOmitWorkspaceResolutionValue('patch:pkg@1.0.0')).toBe(false);
    expect(shouldOmitWorkspaceResolutionValue('file:./vendor/pkg')).toBe(false);
    expect(shouldOmitWorkspaceResolutionValue(1)).toBe(false);
    expect(shouldOmitWorkspaceResolutionValue(null)).toBe(false);
  });
});

describe('filterWorkspaceResolutionsForDynamicExport', () => {
  it('partitions portable vs omitted keys', () => {
    const { kept, omittedKeys } = filterWorkspaceResolutionsForDynamicExport({
      a: 'workspace:*',
      b: '1.0.0',
      c: 'portal:../foo',
      d: { nested: true },
    });
    expect(kept).toEqual({ b: '1.0.0' });
    expect(
      [...omittedKeys].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' }),
      ),
    ).toEqual(['a', 'c', 'd']);
  });
});

describe('customizeForDynamicUse resolutions merge', () => {
  it('merges workspace after pack and additionalResolutions wins on conflict', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rhdh-cli-wsres-'));
    const pkgPath = path.join(dir, 'package.json');
    await fs.writeJson(
      pkgPath,
      {
        name: 'test-pkg',
        version: '1.0.0',
        dependencies: {},
        resolutions: { foo: 'from-pack', bar: 'from-pack-bar' },
      },
      { spaces: 2 },
    );

    const run = customizeForDynamicUse({
      embedded: [],
      isYarnV1: false,
      workspaceResolutions: { foo: 'from-workspace', baz: 'from-ws-baz' },
      additionalResolutions: { foo: 'from-additional' },
    });
    await run(pkgPath);

    const out = await fs.readJson(pkgPath);
    expect(out.resolutions.foo).toBe('from-additional');
    expect(out.resolutions.bar).toBe('from-pack-bar');
    expect(out.resolutions.baz).toBe('from-ws-baz');
    expect(out.resolutions['@aws-sdk/util-utf8-browser']).toBe(
      'npm:@smithy/util-utf8@~2',
    );

    await fs.remove(dir);
  });

  it('merges workspace resolutions without a direct dependency (transitive / CVE pins)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rhdh-cli-wsres2-'));
    const pkgPath = path.join(dir, 'package.json');
    await fs.writeJson(
      pkgPath,
      {
        name: 'backend-only',
        version: '1.0.0',
        dependencies: { 'my-backend-lib': '1' },
      },
      { spaces: 2 },
    );

    const run = customizeForDynamicUse({
      embedded: [],
      isYarnV1: false,
      workspaceResolutions: {
        react: '^18',
        'my-backend-lib': 'patch:foo',
      },
    });
    await run(pkgPath);

    const out = await fs.readJson(pkgPath);
    expect(out.resolutions.react).toBe('^18');
    expect(out.resolutions['my-backend-lib']).toBe('patch:foo');

    await fs.remove(dir);
  });
});

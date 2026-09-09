/*
 * Copyright 2026 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { getEntryPointDefaultFeatureType } from '@backstage/cli-module-build/dist/lib/typeDistProject.cjs.js';

import { getDefaultFeatureType, detectBackstageFeatures } from './features';

jest.mock('@backstage/cli-module-build/dist/lib/entryPoints.cjs.js', () => ({
  readEntryPoints: jest.fn(),
}));
jest.mock(
  '@backstage/cli-module-build/dist/lib/typeDistProject.cjs.js',
  () => ({
    createTypeDistProject: jest.fn(),
    getEntryPointDefaultFeatureType: jest.fn(),
  }),
);

const mockedGetEntryPointDefaultFeatureType =
  getEntryPointDefaultFeatureType as jest.MockedFunction<
    typeof getEntryPointDefaultFeatureType
  >;

interface FakeSourceFile {
  getExportSymbols: () => Array<{
    getDeclarations: () => Array<{
      getSymbol: () => { getName: () => string };
      getName: () => string;
      getKindName: () => string;
      getExportDeclaration: () => {
        getModuleSpecifierSourceFile: () => FakeSourceFile | undefined;
      };
    }>;
  }>;
  getFilePath: () => string;
}

function reExport(
  sourceFile: FakeSourceFile,
  filePath: string,
  localName = 'default',
): FakeSourceFile {
  const declaration = {
    getSymbol: () => ({ getName: () => 'default' }),
    getName: () => localName,
    getKindName: () => 'ExportSpecifier',
    getExportDeclaration: () => ({
      getModuleSpecifierSourceFile: () => sourceFile,
    }),
  };
  return {
    getFilePath: () => filePath,
    getExportSymbols: () => [{ getDeclarations: () => [declaration] }],
  };
}

function projectWith(...sourceFiles: FakeSourceFile[]) {
  const files = new Map(sourceFiles.map(file => [file.getFilePath(), file]));
  return {
    getSourceFile: (filePath: string) => files.get(filePath),
  } as unknown as Parameters<typeof getDefaultFeatureType>[2];
}

describe('getDefaultFeatureType', () => {
  beforeEach(() => {
    mockedGetEntryPointDefaultFeatureType.mockReset();
    mockedGetEntryPointDefaultFeatureType.mockImplementation(
      (_role, _packageDir, _project, entryPoint) =>
        entryPoint.endsWith('/plugin.ts') ? '@backstage/FrontendPlugin' : null,
    );
  });

  it('follows a default re-export to the plugin declaration', () => {
    const plugin = {
      getFilePath: () => '/package/plugin.ts',
      getExportSymbols: () => [],
    };
    const alpha = reExport(plugin, '/package/alpha.ts');

    expect(
      getDefaultFeatureType(
        'frontend-plugin',
        '/package',
        projectWith(alpha, plugin),
        './alpha.ts',
      ),
    ).toBe('@backstage/FrontendPlugin');
  });

  it('follows aliased default exports', () => {
    const plugin = {
      getFilePath: () => '/package/plugin.ts',
      getExportSymbols: () => [],
    };
    const alpha = reExport(plugin, '/package/alpha.ts', 'plugin');

    expect(
      getDefaultFeatureType(
        'frontend-plugin',
        '/package',
        projectWith(alpha, plugin),
        './alpha.ts',
      ),
    ).toBe('@backstage/FrontendPlugin');
  });

  it('returns null when a re-exported source file is missing', () => {
    const alpha = {
      getFilePath: () => '/package/alpha.ts',
      getExportSymbols: () => [],
    };

    expect(
      getDefaultFeatureType(
        'frontend-plugin',
        '/package',
        projectWith(alpha),
        './alpha.ts',
      ),
    ).toBeNull();
  });

  it('does not recurse forever on cyclic re-exports', () => {
    let alpha: FakeSourceFile;
    const cycle = reExport({} as FakeSourceFile, '/package/cycle.ts');
    alpha = reExport(cycle, '/package/alpha.ts');
    const cyclicAlpha = reExport(alpha, '/package/cycle.ts');
    alpha = reExport(cyclicAlpha, '/package/alpha.ts');
    mockedGetEntryPointDefaultFeatureType.mockReturnValue(null);

    expect(
      getDefaultFeatureType(
        'frontend-plugin',
        '/package',
        projectWith(alpha, cyclicAlpha),
        './alpha.ts',
      ),
    ).toBeNull();
  });
});

describe('detectBackstageFeatures', () => {
  it('detects features for multiple entry points', async () => {
    const { readEntryPoints } = jest.requireMock(
      '@backstage/cli-module-build/dist/lib/entryPoints.cjs.js',
    ) as { readEntryPoints: jest.Mock };
    const { createTypeDistProject } = jest.requireMock(
      '@backstage/cli-module-build/dist/lib/typeDistProject.cjs.js',
    ) as { createTypeDistProject: jest.Mock };

    readEntryPoints.mockReturnValue([
      { mount: './alpha', path: './alpha.ts' },
      { mount: './beta', path: './beta.ts' },
    ]);
    createTypeDistProject.mockResolvedValue({
      getSourceFile: () => undefined,
    });
    mockedGetEntryPointDefaultFeatureType.mockImplementation(
      (_role, _packageDir, _project, entryPoint) =>
        entryPoint.endsWith('/alpha.ts')
          ? '@backstage/FrontendPlugin'
          : '@backstage/FrontendModule',
    );

    await expect(
      detectBackstageFeatures(
        { backstage: { role: 'frontend-plugin' } } as any,
        '/package',
      ),
    ).resolves.toEqual({
      './alpha': '@backstage/FrontendPlugin',
      './beta': '@backstage/FrontendModule',
    });
  });
});

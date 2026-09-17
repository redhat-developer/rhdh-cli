import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

import { resolveRhdhVersion } from '../../lib/rhdhVersion';
import {
  completeInteractiveOptions,
  createPluginProject,
  supportedTemplateNames,
} from './command';
import { getRhdhProfile } from './rhdhProfiles';

const frontendDevDependencies = {
  '@testing-library/react': '^16.0.0',
  '@types/react': '^18.0.0',
  '@types/react-dom': '^18.0.0',
  'react-dom': '^18.0.0',
  'react-router-dom': '^6.30.2',
};

jest.mock('../../lib/rhdhVersion', () => ({
  ...jest.requireActual('../../lib/rhdhVersion'),
  resolveRhdhVersion: jest.fn(),
}));

describe('createPluginProject', () => {
  let tmpDir: string;
  const mockResolveRhdhVersion = resolveRhdhVersion as jest.MockedFunction<
    typeof resolveRhdhVersion
  >;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-new-test-'));
    mockResolveRhdhVersion.mockResolvedValue({
      rhdhVersion: '2.1.0',
      backstageVersion: '1.54.6',
      source: 'matrix',
      packages: new Map([
        ['@backstage/backend-defaults', '0.12.5'],
        ['@backstage/backend-plugin-api', '1.10.0'],
        ['@backstage/backend-test-utils', '1.11.5'],
        ['@backstage/catalog-client', '1.10.0'],
        ['@backstage/catalog-model', '1.10.0'],
        ['@backstage/cli', '0.36.5'],
        ['@backstage/cli-common', '0.3.0'],
        ['@backstage/cli-defaults', '0.1.5'],
        ['@backstage/cli-module-build', '0.1.7'],
        ['@backstage/cli-module-test-jest', '0.1.5'],
        ['@backstage/cli-node', '0.3.4'],
        ['@backstage/config', '1.3.8'],
        ['@backstage/core-components', '0.17.0'],
        ['@backstage/core-plugin-api', '1.12.7'],
        ['@backstage/errors', '1.3.1'],
        ['@backstage/frontend-defaults', '0.1.0'],
        ['@backstage/frontend-dev-utils', '0.4.5'],
        ['@backstage/frontend-plugin-api', '0.17.2'],
        ['@backstage/frontend-test-utils', '0.2.0'],
        ['@backstage/plugin-catalog-node', '2.2.4'],
        ['@backstage/theme', '0.6.0'],
        ['@backstage/types', '1.2.2'],
        ['@backstage/ui', '0.10.0'],
      ]),
    });
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
    jest.clearAllMocks();
  });

  it.each([
    [
      'frontend',
      'src/plugin.tsx',
      'createFrontendPlugin',
      frontendDevDependencies,
    ],
    ['backend', 'src/plugin.ts', 'createBackendPlugin', {}],
    [
      'catalog-processor-module',
      'src/module.ts',
      'catalogProcessingExtensionPoint',
      {},
    ],
  ])(
    'creates a %s plugin project',
    async (type, entryPoint, expectedSource, expectedReactDevDependencies) => {
      const output = path.join(tmpDir, type);

      const result = await createPluginProject({
        name: 'example-plugin',
        type,
        output,
        rhdhVersion: '2.1.0',
      });

      expect(result).toEqual({
        outputDir: output,
        rhdhVersion: '2.1.0',
        backstageVersion: '1.54.6',
      });
      expect(mockResolveRhdhVersion).toHaveBeenCalledWith('2.1.0', {
        manifestFile: undefined,
      });
      expect(
        await fs.readFile(path.join(output, entryPoint), 'utf8'),
      ).toContain(expectedSource);

      const packageJson = await fs.readJson(path.join(output, 'package.json'));
      expect(packageJson.devDependencies['@backstage/cli']).toBe('0.36.5');
      expect(packageJson.devDependencies).not.toHaveProperty(
        '@red-hat-developer-hub/cli',
      );
      expect(packageJson.files).toEqual(['dist']);
      expect(packageJson.scripts.start).toBe('backstage-cli package start');
      expect(packageJson.packageManager).toBe('yarn@4.17.1');
      expect(packageJson.devDependencies['@types/jest']).toBe('^29.5.14');
      expect(packageJson.devDependencies.jest).toBe('^29.7.0');
      expect(packageJson.devDependencies['jest-environment-jsdom']).toBe(
        '^29.7.0',
      );
      expect(packageJson.devDependencies['@backstage/cli-defaults']).toBe(
        '0.1.5',
      );
      expect(packageJson.devDependencies.typescript).toBe('5.4.5');
      expect(packageJson.resolutions['@types/express']).toBe('4.17.21');
      expect(Object.keys(packageJson.resolutions).sort()).toEqual([
        '@types/express',
      ]);
      expect(
        Object.fromEntries(
          Object.entries(packageJson.devDependencies).filter(([name]) =>
            Object.hasOwn(frontendDevDependencies, name),
          ),
        ),
      ).toEqual(expectedReactDevDependencies);
      await expect(
        fs.readFile(path.join(output, '.yarnrc.yml'), 'utf8'),
      ).resolves.toBe('nodeLinker: node-modules\n');
      await expect(
        fs.readJson(path.join(output, 'backstage.json')),
      ).resolves.toEqual({ version: '1.54.6' });
      await expect(
        fs.readJson(path.join(output, 'tsconfig.json')),
      ).resolves.toEqual({
        extends: '@backstage/cli/config/tsconfig.json',
        include: ['src', 'dev', 'migrations'],
        compilerOptions: {
          jsx: 'react-jsx',
          outDir: 'dist-types',
          rootDir: '.',
        },
      });
      await expect(
        fs.readFile(path.join(output, 'README.md'), 'utf8'),
      ).resolves.toContain('npx @red-hat-developer-hub/cli plugin export');

      await expect(
        Promise.all(
          [
            '.eslintrc.js',
            '.yarnrc.yml',
            'README.md',
            'backstage.json',
            'package.json',
            'tsconfig.json',
            ...(type === 'frontend'
              ? [
                  'src/plugin.tsx',
                  'src/routes.ts',
                  'src/components/TodoPage/TodoPage.tsx',
                  'dev/index.tsx',
                ]
              : []),
            ...(type === 'backend' ? ['src/plugin.ts', 'src/router.ts'] : []),
            ...(type === 'catalog-processor-module' ? ['src/module.ts'] : []),
          ].map(async file => [
            file,
            await fs.readFile(path.join(output, file), 'utf8'),
          ]),
        ),
      ).resolves.toMatchSnapshot();
    },
  );

  it('rejects an unsupported plugin type', async () => {
    await expect(
      createPluginProject({
        name: 'example-plugin',
        output: path.join(tmpDir, 'module'),
        type: 'backend-plugin-module',
      }),
    ).rejects.toThrow('Plugin type must be one of');
  });

  it('accepts --template as an alternative to --type', async () => {
    const output = path.join(tmpDir, 'template-frontend');

    const result = await createPluginProject({
      name: 'example-plugin',
      template: 'frontend-plugin',
      output,
      rhdhVersion: '2.1.0',
    });

    expect(result).toEqual({
      outputDir: output,
      rhdhVersion: '2.1.0',
      backstageVersion: '1.54.6',
    });
    expect(
      await fs.readFile(path.join(output, 'src/plugin.tsx'), 'utf8'),
    ).toContain('createFrontendPlugin');
  });

  it('rejects an unsupported --template value before resolving a version', async () => {
    await expect(
      createPluginProject({
        name: 'example-plugin',
        template: 'backend-plugin-module',
        output: path.join(tmpDir, 'bad-template'),
      }),
    ).rejects.toThrow('Unsupported template');
    expect(mockResolveRhdhVersion).not.toHaveBeenCalled();
  });

  it('exposes all supported template names', () => {
    expect(supportedTemplateNames).toEqual([
      'frontend-plugin',
      'backend-plugin',
      'catalog-processor-module',
    ]);
  });

  it('accepts --module-id to override the module identifier', async () => {
    const output = path.join(tmpDir, 'custom-module-id');

    await createPluginProject({
      name: 'example-plugin',
      type: 'catalog-processor-module',
      moduleId: 'my-module',
      output,
      rhdhVersion: '2.1.0',
    });

    // processorClass = upperFirst(camelCase('my-module')) + 'Processor' = 'MyModuleProcessor'
    expect(
      await fs.readFile(
        path.join(output, 'src/processor/MyModuleProcessor.ts'),
        'utf8',
      ),
    ).toContain('MyModuleProcessor');
  });

  it('rejects RHDH versions other than 2.1', async () => {
    mockResolveRhdhVersion.mockResolvedValueOnce({
      rhdhVersion: '2.0.4',
      backstageVersion: '1.52.0',
      source: 'matrix',
      packages: new Map(),
    });

    await expect(
      createPluginProject({
        name: 'example-plugin',
        type: 'frontend',
        output: path.join(tmpDir, 'unsupported'),
        rhdhVersion: '2.0.4',
      }),
    ).rejects.toThrow('supports RHDH 2.1 only');
  });

  it('selects the RHDH 2.1 upstream-template profile', () => {
    expect(getRhdhProfile('2.1.0')).toMatchObject({
      templatePackageVersion: '0.1.6',
      packageManager: 'yarn@4.17.1',
      devDependencies: {
        '@backstage/cli-defaults': '0.1.5',
        jest: '^29.7.0',
      },
      templateRoleOverlays: {
        'frontend-plugin': {
          devDependencies: {
            'react-dom': '^18.0.0',
            'react-router-dom': '^6.30.2',
          },
        },
      },
    });
    expect(() => getRhdhProfile('2.0.4')).toThrow('supports RHDH 2.1 only');
  });

  it('rejects an invalid name before resolving a version', async () => {
    await expect(
      createPluginProject({
        name: 'Example',
        type: 'frontend',
        output: tmpDir,
      }),
    ).rejects.toThrow('Plugin name must start');
    expect(mockResolveRhdhVersion).not.toHaveBeenCalled();
  });

  it.each([
    ['whitespace in name', 'my package', 'valid npm package name'],
    ['control character', 'pkg\x01name', 'valid npm package name'],
    ['name exceeding 214 chars', 'a'.repeat(215), '214 characters or fewer'],
    ['invalid characters', 'My_Package!', 'valid npm package name'],
  ])(
    'rejects an invalid --plugin-package value (%s) before resolving a version',
    async (_label, pluginPackage, expectedError) => {
      await expect(
        createPluginProject({
          name: 'example-plugin',
          type: 'frontend',
          pluginPackage,
          output: tmpDir,
        }),
      ).rejects.toThrow(expectedError);
      expect(mockResolveRhdhVersion).not.toHaveBeenCalled();
    },
  );

  it('rejects a non-empty output directory', async () => {
    await fs.outputFile(path.join(tmpDir, 'existing'), 'content');

    await expect(
      createPluginProject({
        name: 'example',
        type: 'frontend',
        output: tmpDir,
      }),
    ).rejects.toThrow('is not empty');
    expect(mockResolveRhdhVersion).not.toHaveBeenCalled();
  });

  it('cleans an existing empty output directory after template rendering fails', async () => {
    const output = path.join(tmpDir, 'existing-empty');
    await fs.ensureDir(output);
    mockResolveRhdhVersion.mockResolvedValueOnce({
      rhdhVersion: '2.1.0',
      backstageVersion: '1.54.6',
      source: 'matrix',
      packages: new Map(),
    });

    await expect(
      createPluginProject({
        name: 'example',
        type: 'frontend',
        output,
      }),
    ).rejects.toThrow('does not contain');

    await expect(fs.readdir(output)).resolves.toEqual([]);
  });

  it('removes a newly created output directory after template rendering fails', async () => {
    const output = path.join(tmpDir, 'new-output');
    mockResolveRhdhVersion.mockResolvedValueOnce({
      rhdhVersion: '2.1.0',
      backstageVersion: '1.54.6',
      source: 'matrix',
      packages: new Map(),
    });

    await expect(
      createPluginProject({
        name: 'example',
        type: 'frontend',
        output,
      }),
    ).rejects.toThrow('does not contain');

    await expect(fs.pathExists(output)).resolves.toBe(false);
  });

  it('prompts only for missing name and plugin type', async () => {
    const prompt = jest
      .fn<Promise<string>, [string]>()
      .mockResolvedValueOnce('example-plugin')
      .mockResolvedValueOnce('frontend');

    await expect(
      completeInteractiveOptions({ rhdhVersion: '2.1.0' }, prompt),
    ).resolves.toEqual({
      name: 'example-plugin',
      type: 'frontend',
      rhdhVersion: '2.1.0',
    });
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it('skips the type prompt when --template is already set', async () => {
    const prompt = jest
      .fn<Promise<string>, [string]>()
      .mockResolvedValueOnce('example-plugin');

    await expect(
      completeInteractiveOptions(
        { template: 'backend-plugin', rhdhVersion: '2.1.0' },
        prompt,
      ),
    ).resolves.toEqual({
      name: 'example-plugin',
      type: 'backend-plugin',
      template: 'backend-plugin',
      rhdhVersion: '2.1.0',
    });
    expect(prompt).toHaveBeenCalledTimes(1);
  });
});

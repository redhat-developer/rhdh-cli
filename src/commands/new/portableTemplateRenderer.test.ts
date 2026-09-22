import fs from 'fs-extra';
import mockFs from 'mock-fs';
import { resolve as resolvePath } from 'node:path';

import { renderPortableTemplate } from './portableTemplateRenderer';

describe('renderPortableTemplate', () => {
  afterEach(() => {
    mockFs.restore();
  });

  it('renders template values, Handlebars helpers, and templated filenames', async () => {
    mockFs({
      template: {
        'portable-template.yaml': 'role: frontend-plugin',
        src: {
          '{{camelCase pluginName}}.ts.hbs':
            '{{upperFirst pluginName}} {{pluginVariable}} {{versionQuery "mock-pkg"}}',
        },
      },
      output: {},
    });

    await renderPortableTemplate(
      'template',
      'output',
      { pluginName: 'example plugin' },
      () => '^0.1.2',
      { pluginVariable: '{{camelCase pluginName}}Plugin' },
    );

    await expect(
      fs.readFile(resolvePath('output', 'src/examplePlugin.ts'), 'utf8'),
    ).resolves.toBe('Example plugin examplePluginPlugin ^0.1.2');
    await expect(
      fs.pathExists(resolvePath('output', 'portable-template.yaml')),
    ).resolves.toBe(false);
  });

  it('uses the overlay file when it exists, leaving other upstream files untouched', async () => {
    mockFs({
      template: {
        'portable-template.yaml': 'role: frontend-plugin',
        'original.ts.hbs': 'original content: {{pluginName}}',
        src: {
          'component.ts.hbs': 'upstream component: {{pluginName}}',
        },
      },
      overlay: {
        // Shadows template/src/component.ts.hbs but not template/original.ts.hbs
        src: {
          'component.ts.hbs': 'patched component: {{pluginName}}',
        },
      },
      output: {},
    });

    await renderPortableTemplate(
      'template',
      'output',
      { pluginName: 'my-plugin' },
      () => '^0.1.2',
      {},
      'overlay',
    );

    // Overlay file wins for src/component.ts
    await expect(
      fs.readFile(resolvePath('output', 'src/component.ts'), 'utf8'),
    ).resolves.toBe('patched component: my-plugin');
    // Upstream file is used when no overlay exists
    await expect(
      fs.readFile(resolvePath('output', 'original.ts'), 'utf8'),
    ).resolves.toBe('original content: my-plugin');
  });

  it('falls through to the upstream file when the overlay directory is absent', async () => {
    mockFs({
      template: {
        'portable-template.yaml': 'role: frontend-plugin',
        'file.ts.hbs': 'upstream: {{pluginName}}',
      },
      output: {},
      // No overlay directory present
    });

    await renderPortableTemplate(
      'template',
      'output',
      { pluginName: 'my-plugin' },
      () => '^0.1.2',
      {},
      'nonexistent-overlay',
    );

    await expect(
      fs.readFile(resolvePath('output', 'file.ts'), 'utf8'),
    ).resolves.toBe('upstream: my-plugin');
  });

  it('rejects a rendered filename outside the destination directory', async () => {
    mockFs({
      template: {
        '{{fileName}}.txt.hbs': 'content',
      },
      output: {},
    });

    await expect(
      renderPortableTemplate(
        'template',
        'output',
        { fileName: '../outside' },
        () => '^0.1.2',
        {},
      ),
    ).rejects.toThrow('escapes destination');
  });
});

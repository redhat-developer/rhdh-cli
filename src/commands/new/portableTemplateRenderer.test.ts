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

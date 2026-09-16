import { OptionValues } from 'commander';
import fs from 'fs-extra';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import YAML from 'yaml';

import { resolveRhdhVersion } from '../../lib/rhdhVersion';
import { Task } from '../../lib/tasks';
import { renderPortableTemplate } from './portableTemplateRenderer';
import {
  applyRhdhTemplateRoleOverlay,
  getRhdhProfile,
  RhdhProfile,
} from './rhdhProfiles';

export const pluginTypes = [
  'frontend',
  'backend',
  'catalog-processor-module',
] as const;
export type PluginType = (typeof pluginTypes)[number];

const templateAliases: Record<PluginType, string> = {
  frontend: 'frontend-plugin',
  backend: 'backend-plugin',
  'catalog-processor-module': 'catalog-processor-module',
};

export interface CreatePluginOptions {
  name?: string;
  type?: string;
  template?: string;
  moduleId?: string;
  pluginPackage?: string;
  targetPluginPackage?: string;
  output?: string;
  rhdhVersion?: string;
  manifestFile?: string;
}

export interface PluginProjectResult {
  outputDir: string;
  rhdhVersion: string;
  backstageVersion: string;
}

type Prompt = (question: string) => Promise<string>;

const rhdhReadmeSection = `
## RHDH dynamic plugin export

Export this plugin for RHDH without adding the CLI as a dependency:

\`\`\`bash
npx @red-hat-developer-hub/cli plugin export
\`\`\`
`;

function assertPluginName(name: string): void {
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
    throw new Error(
      'Plugin name must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens.',
    );
  }
}

function resolveTemplateName(options: CreatePluginOptions): string {
  if (options.template && options.type) {
    throw new Error('Use either --template or --type, not both.');
  }
  if (options.template) {
    if (!/^[a-z0-9-]+$/.test(options.template)) {
      throw new Error(
        'Template names may contain only lowercase letters, numbers, and hyphens.',
      );
    }
    return options.template;
  }
  if (!options.type || !pluginTypes.includes(options.type as PluginType)) {
    throw new Error(`Plugin type must be one of: ${pluginTypes.join(', ')}.`);
  }
  return templateAliases[options.type as PluginType];
}

async function loadTemplate(
  templateName: string,
  profile: RhdhProfile,
): Promise<{
  directory: string;
  role: string;
  values: Record<string, string>;
}> {
  const packageJson = require('@backstage/cli-module-new/package.json') as {
    version: string;
  };
  if (packageJson.version !== profile.templatePackageVersion) {
    throw new Error(
      `RHDH template adapter requires @backstage/cli-module-new ${profile.templatePackageVersion}, found ${packageJson.version}.`,
    );
  }
  const packageJsonPath = require.resolve(
    '@backstage/cli-module-new/package.json',
  );
  const directory = path.join(
    path.dirname(packageJsonPath),
    'templates',
    templateName,
  );
  const templateFile = path.join(directory, 'portable-template.yaml');
  if (!(await fs.pathExists(templateFile))) {
    throw new Error(`Unknown upstream template "${templateName}".`);
  }
  const template = YAML.parse(await fs.readFile(templateFile, 'utf8')) as {
    role?: unknown;
    values?: unknown;
  };
  if (typeof template.role !== 'string') {
    throw new TypeError(`Template "${templateName}" has no role.`);
  }
  const values = Object.fromEntries(
    Object.entries(template.values ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  return { directory, role: template.role, values };
}

async function adaptStandaloneProject(
  outputDir: string,
  backstageVersion: string,
  profile: Omit<RhdhProfile, 'templateRoleOverlays'>,
): Promise<void> {
  const packageJsonPath = path.join(outputDir, 'package.json');
  const packageJson = await fs.readJson(packageJsonPath);
  packageJson.packageManager = profile.packageManager;
  packageJson.devDependencies = {
    ...packageJson.devDependencies,
    ...profile.devDependencies,
  };
  packageJson.resolutions = {
    ...packageJson.resolutions,
    ...profile.resolutions,
  };

  await Promise.all([
    fs.writeJson(packageJsonPath, packageJson, { spaces: 2 }),
    fs.writeFile(
      path.join(outputDir, '.yarnrc.yml'),
      'nodeLinker: node-modules\n',
    ),
    fs.writeJson(
      path.join(outputDir, 'backstage.json'),
      { version: backstageVersion },
      { spaces: 2 },
    ),
    fs.writeJson(
      path.join(outputDir, 'tsconfig.json'),
      {
        extends: '@backstage/cli/config/tsconfig.json',
        include: ['src', 'dev', 'migrations'],
        compilerOptions: {
          jsx: 'react-jsx',
          outDir: 'dist-types',
          rootDir: '.',
        },
      },
      { spaces: 2 },
    ),
  ]);
  await fs.appendFile(path.join(outputDir, 'README.md'), rhdhReadmeSection);
}

/** Prompts for any plugin creation options omitted by the caller. */
export async function completeInteractiveOptions(
  options: CreatePluginOptions,
  prompt: Prompt,
): Promise<CreatePluginOptions> {
  const name = options.name || (await prompt('Plugin name: ')).trim();
  const type =
    options.type ||
    options.template ||
    (
      await prompt(
        'Plugin type or template (frontend, backend, catalog-processor-module): ',
      )
    ).trim();
  if (!name || !type) {
    throw new Error('Plugin name and type cannot be empty.');
  }
  if (options.template || !pluginTypes.includes(type as PluginType)) {
    return { ...options, name, type: undefined, template: type };
  }
  return { ...options, name, type };
}

async function promptForMissingOptions(
  options: CreatePluginOptions,
): Promise<CreatePluginOptions> {
  if (options.name && (options.type || options.template)) {
    return options;
  }
  if (!process.stdin.isTTY) {
    const missing = [
      !options.name && 'plugin name',
      !options.type && !options.template && '--type or --template',
    ].filter(Boolean);
    throw new Error(
      `${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} required when running without an interactive terminal.`,
    );
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await completeInteractiveOptions(options, question =>
      readline.question(question),
    );
  } finally {
    readline.close();
  }
}

/** Creates a standalone plugin project from a version-pinned template. */
export async function createPluginProject(
  options: CreatePluginOptions,
): Promise<PluginProjectResult> {
  if (!options.name) {
    throw new Error(
      'Plugin name is required. Pass it as an argument or with --name.',
    );
  }
  assertPluginName(options.name);
  const templateName = resolveTemplateName(options);

  const outputDir = path.resolve(options.output || options.name);
  const outputExisted = await fs.pathExists(outputDir);
  if (outputExisted) {
    const contents = await fs.readdir(outputDir);
    if (contents.length > 0) {
      throw new Error(`Output directory "${outputDir}" is not empty.`);
    }
  }

  const resolved = await resolveRhdhVersion(options.rhdhVersion, {
    manifestFile: options.manifestFile,
  });
  const profile = getRhdhProfile(resolved.rhdhVersion);
  const template = await loadTemplate(templateName, profile);
  const moduleId =
    options.moduleId ||
    (options.type === 'catalog-processor-module' ? options.name : undefined);
  if (template.role.endsWith('-module') && !moduleId) {
    throw new Error('--module-id is required for upstream module templates.');
  }
  if (
    (templateName === 'backend-plugin-module' ||
      templateName === 'frontend-plugin-module') &&
    !options.targetPluginPackage
  ) {
    throw new Error(
      '--target-plugin-package is required for this upstream module template.',
    );
  }
  const versionProvider = (
    packageName: string,
    versionHint?: string,
  ): string => {
    const version = resolved.packages.get(packageName);
    if (version) {
      return version;
    }
    if (versionHint) {
      return versionHint;
    }
    throw new Error(
      `The Backstage ${resolved.backstageVersion} release manifest does not contain ${packageName}.`,
    );
  };

  await fs.ensureDir(outputDir);
  try {
    await renderPortableTemplate(
      template.directory,
      outputDir,
      {
        pluginId: options.name,
        moduleId,
        pluginPackage: options.targetPluginPackage,
        name: options.name,
        packageName:
          options.pluginPackage || `@internal/backstage-plugin-${options.name}`,
        rhdhVersion: resolved.rhdhVersion,
        backstageVersion: resolved.backstageVersion,
      },
      versionProvider,
      template.values,
    );
    await adaptStandaloneProject(
      outputDir,
      resolved.backstageVersion,
      applyRhdhTemplateRoleOverlay(profile, template.role),
    );
  } catch (error) {
    await (outputExisted ? fs.emptyDir(outputDir) : fs.remove(outputDir)).catch(
      () => undefined,
    );
    throw error;
  }

  return {
    outputDir,
    rhdhVersion: resolved.rhdhVersion,
    backstageVersion: resolved.backstageVersion,
  };
}

/** CLI command entry point for `rhdh-cli plugin new`. */
export async function command(
  name: string | undefined,
  opts: OptionValues,
): Promise<void> {
  if (name && opts.name && name !== opts.name) {
    throw new Error(
      'Plugin name argument and --name must match when both are provided.',
    );
  }

  const options = await promptForMissingOptions({
    name: name || opts.name,
    type: opts.type,
    template: opts.template,
    moduleId: opts.moduleId,
    pluginPackage: opts.pluginPackage,
    targetPluginPackage: opts.targetPluginPackage,
    output: opts.output,
    rhdhVersion: opts.rhdhVersion,
    manifestFile: opts.manifestFile,
  });
  const result = await createPluginProject(options);

  Task.log(
    `Created plugin in ${result.outputDir} for RHDH ${result.rhdhVersion} (Backstage ${result.backstageVersion}).\n`,
  );
}

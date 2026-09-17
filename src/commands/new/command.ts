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

/**
 * Root of the RHDH-owned template overlay tree, relative to this file's
 * compiled location. The tree mirrors the upstream @backstage/cli-module-new
 * template structure: `<overlaysRoot>/<upstream-template-name>/<relative-file>`.
 *
 * Files present here shadow the corresponding upstream template file during
 * rendering. Use overlays to patch individual files that are incompatible with
 * a specific RHDH release without forking the full upstream template. When the
 * upstream template package is upgraded, audit each overlay and remove it if
 * the upstream has caught up.
 *
 * In both the TypeScript source tree (`src/commands/new/`) and the compiled
 * output (`dist/commands/new/`), this file is three directories below the
 * package root, so `../../..` reliably resolves to the package root where
 * `templates/plugin-new/` lives.
 *
 * Note: `__dirname` is intentional here. The CLI uses it the same way
 * `src/lib/paths.ts` does — to locate package-relative assets shipped
 * alongside the compiled output. `resolvePackagePath()` from
 * `@backstage/backend-plugin-api` is not appropriate for a CLI tool.
 */
const RHDH_TEMPLATE_OVERLAYS_ROOT = path.resolve(
  /* eslint-disable-next-line no-restricted-syntax */
  __dirname,
  '../../../templates/plugin-new',
);

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

/** Upstream template names accepted by `--template`. Constrained to templates with e2e coverage. */
export const supportedTemplateNames = Object.values(templateAliases);

export interface CreatePluginOptions {
  name?: string;
  type?: string;
  /** Upstream template name (e.g. 'frontend-plugin'). Overrides `type` when provided. */
  template?: string;
  /** Module ID for module-type templates. Defaults to the plugin name. */
  moduleId?: string;
  /** Generated package name. Defaults to `@internal/backstage-plugin-<name>`. Validated against npm name rules. */
  pluginPackage?: string;
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

const RHDH_README_SECTION = `
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

function assertPackageName(packageName: string): void {
  // npm package name rules: max 214 chars, lowercase, no whitespace or
  // special characters other than hyphens, dots, underscores, and scoped
  // package prefixes (@scope/).
  if (packageName.length > 214) {
    throw new Error('Package name must be 214 characters or fewer.');
  }
  if (
    !/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(packageName)
  ) {
    throw new Error(
      'Package name must be a valid npm package name (lowercase, no whitespace or special characters other than hyphens, dots, and underscores).',
    );
  }
}

function resolveTemplateName(options: CreatePluginOptions): string {
  if (options.template) {
    if (!supportedTemplateNames.includes(options.template)) {
      throw new Error(
        `Unsupported template "${options.template}". Supported templates: ${supportedTemplateNames.join(', ')}.`,
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
  /** RHDH overlay directory for this template, or undefined if empty. */
  overlayDir: string | undefined;
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
  // The overlay directory shadows individual upstream files that need
  // RHDH-specific fixes. Only pass it to the renderer when it actually exists
  // so the renderer's fs.pathExists check per file is the only hot path.
  const overlayDir = path.join(RHDH_TEMPLATE_OVERLAYS_ROOT, templateName);
  const overlayExists = await fs.pathExists(overlayDir);
  return {
    directory,
    overlayDir: overlayExists ? overlayDir : undefined,
    role: template.role,
    values,
  };
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
  await fs.appendFile(path.join(outputDir, 'README.md'), RHDH_README_SECTION);
}

/** Prompts for any plugin creation options omitted by the caller. */
export async function completeInteractiveOptions(
  options: CreatePluginOptions,
  prompt: Prompt,
): Promise<CreatePluginOptions> {
  const name = options.name || (await prompt('Plugin name: ')).trim();
  // A --template value satisfies the type requirement; only prompt when both are absent.
  const type =
    options.type ||
    options.template ||
    (
      await prompt(
        'Plugin type (frontend, backend, catalog-processor-module) ' +
          'or upstream template name (frontend-plugin, backend-plugin, catalog-processor-module): ',
      )
    ).trim();
  if (!name || !type) {
    throw new Error('Plugin name and type cannot be empty.');
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
  if (options.moduleId) {
    assertPluginName(options.moduleId);
  }
  if (options.pluginPackage) {
    assertPackageName(options.pluginPackage);
  }
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
    // Module templates (e.g. catalog-processor-module) derive generated
    // identifiers from moduleId. Default it to the plugin name so that
    // non-interactive invocations work without --module-id.
    const isModuleTemplate = template.role.endsWith('-module');
    const moduleId =
      options.moduleId || (isModuleTemplate ? options.name : undefined);

    await renderPortableTemplate(
      template.directory,
      outputDir,
      {
        pluginId: options.name,
        moduleId,
        pluginPackage: undefined,
        name: options.name,
        packageName:
          options.pluginPackage || `@internal/backstage-plugin-${options.name}`,
        rhdhVersion: resolved.rhdhVersion,
        backstageVersion: resolved.backstageVersion,
      },
      versionProvider,
      template.values,
      template.overlayDir,
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
    output: opts.output,
    rhdhVersion: opts.rhdhVersion,
    manifestFile: opts.manifestFile,
  });
  const result = await createPluginProject(options);

  Task.log(
    `Created plugin in ${result.outputDir} for RHDH ${result.rhdhVersion} (Backstage ${result.backstageVersion}).\n`,
  );
}

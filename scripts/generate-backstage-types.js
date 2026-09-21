#!/usr/bin/env node

const fs = require('fs-extra');
const os = require('node:os');
const path = require('path');
const { execSync } = require('child_process');
const tar = require('tar');
const stream = require('stream');

/**
 * Script to automatically generate TypeScript declarations for @backstage/cli
 * based on the version specified in package.json
 */

const CLI_MODULE_BUILD_PREFIX = '@backstage/cli-module-build/dist/';

function typesPathToModuleName(typesPath) {
  const normalized = typesPath.replaceAll(/\\/g, '/');
  const match = normalized.match(
    /dist-types\/packages\/cli-module-build\/src\/(.+)\.d\.ts$/,
  );
  if (!match) {
    throw new Error(`Unexpected types path: ${typesPath}`);
  }
  return `${CLI_MODULE_BUILD_PREFIX}${match[1]}.cjs.js`;
}

function moduleNameToTypesPath(moduleName) {
  if (!moduleName.startsWith(CLI_MODULE_BUILD_PREFIX)) {
    throw new Error(`Unexpected module name: ${moduleName}`);
  }
  const relativePath = moduleName.slice(
    CLI_MODULE_BUILD_PREFIX.length,
    -'.cjs.js'.length,
  );
  return `dist-types/packages/cli-module-build/src/${relativePath}.d.ts`;
}

function rewriteRelativeImports(content, currentTypesPath) {
  const currentDir = path.dirname(currentTypesPath);

  return content.replace(
    /from\s+['"](\.[^'"]+)['"]/g,
    (_match, relativeImport) => {
      const resolvedTypesPath = path.normalize(
        path.join(currentDir, `${relativeImport}.d.ts`),
      );
      const moduleName = typesPathToModuleName(resolvedTypesPath);
      return `from '${moduleName}'`;
    },
  );
}

function stripRedundantDeclare(content) {
  return content.replace(/\bexport declare\b/g, 'export');
}

function collectCliModuleBuildImports(content) {
  const imports = new Set();
  const pattern = new RegExp(
    `from ['"]${CLI_MODULE_BUILD_PREFIX.replace(
      /[.*+?^${}()|[\]\\]/g,
      String.raw`$&`,
    )}[^'"]+['"]`,
    'g',
  );

  for (const match of content.matchAll(pattern)) {
    imports.add(match[0].slice(6, -1));
  }

  return imports;
}

function ensureNewlineAfterImports(content) {
  const lines = content.split('\n');
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    result.push(lines[i]);

    if (!/^\s*import\s/.test(lines[i])) {
      continue;
    }

    const nextLine = lines[i + 1];
    const nextIsImport =
      nextLine !== undefined && /^\s*import\s/.test(nextLine);

    if (!nextIsImport && nextLine !== undefined && nextLine.trim() !== '') {
      result.push('');
    }
  }

  return result.join('\n');
}

function formatModuleTypes(content, typesPath) {
  return ensureNewlineAfterImports(
    stripRedundantDeclare(rewriteRelativeImports(content, typesPath)),
  );
}

async function generateBackstageTypes() {
  console.log('🔄 Generating Backstage CLI types...');

  const rootPath = path.resolve(__dirname, '..');
  // Read package.json to get the Backstage CLI version
  const packageJsonPath = path.resolve(rootPath, 'package.json');
  const packageJson = await fs.readJson(packageJsonPath);
  const backstageCliVersion = packageJson.dependencies['@backstage/cli'];

  const backstageVersionCommentPrefix = `Generated from @backstage/cli version:`;

  if (!backstageCliVersion) {
    throw new Error('@backstage/cli not found in dependencies');
  }

  // Clean version by removing semver prefixes
  const cleanVersion = backstageCliVersion.replace(/^[~^]/, '');

  if (backstageCliVersion.match(/^[~^].*/)) {
    throw new Error('@backstage/cli dependency is not a fixed one');
  }

  console.log(`📦 Using @backstage/cli version: ${backstageCliVersion}`);

  // Use system temp dir so Backstage's older Yarn does not inherit this repo's
  // .yarnrc.yml settings (e.g. approvedGitRepositories, unsupported in Yarn 4.8.x).
  const tempDir = path.join(os.tmpdir(), 'rhdh-cli-backstage-types');
  const outputDir = path.resolve(rootPath, 'src', 'generated');
  const outputFile = path.resolve(outputDir, 'backstage-cli-types.d.ts');

  // try to check if the output file already exists and if it does, check if the version comment is the same
  if (await fs.pathExists(outputFile)) {
    const fileContent = await fs.readFile(outputFile, 'utf8');
    if (
      fileContent.includes(`${backstageVersionCommentPrefix} ${cleanVersion}`)
    ) {
      console.log('✅ Output file already exists and is up to date');
      return;
    }
  }

  await fs.remove(tempDir);
  await fs.remove(outputDir);
  await fs.ensureDir(tempDir);
  await fs.ensureDir(outputDir);

  let success = false;
  try {
    // Get the exact git commit for the CLI version using npm view
    console.log(`🔍 Getting git commit for @backstage/cli@${cleanVersion}...`);

    const gitHeadOutput = execSync(
      `npm view @backstage/cli@${cleanVersion} gitHead`,
      {
        encoding: 'utf8',
        stdio: 'pipe',
      },
    ).trim();

    if (!gitHeadOutput) {
      throw new Error(
        `Could not get git commit for @backstage/cli@${cleanVersion}. Version may not exist.`,
      );
    }

    console.log(`📋 Found git commit: ${gitHeadOutput}`);

    // Clone Backstage repository and checkout the exact commit
    console.log(
      `🔽 Exporting Backstage repository on commit ${gitHeadOutput}...`,
    );

    // Create backstage-repo directory first
    const backstageRepoPath = path.resolve(tempDir, 'backstage-repo');
    await fs.ensureDir(backstageRepoPath);

    // Download the tarball and extract it using the 'tar' npm package
    const tarballUrl = `https://github.com/backstage/backstage/archive/${gitHeadOutput}.tar.gz`;
    const extractDir = path.join(tempDir, 'backstage-repo');

    const res = await fetch(tarballUrl);
    if (!res.ok) {
      throw new Error(
        `Failed to download tarball: ${res.status} ${res.statusText}`,
      );
    }
    await new Promise((resolve, reject) => {
      stream.Readable.fromWeb(res.body)
        .pipe(
          tar.x({
            cwd: extractDir,
            strip: 1,
          }),
        )
        .on('error', reject)
        .on('finish', resolve)
        .on('close', resolve);
    });

    console.log(
      `✅ Successfully downloaded Backstage at commit ${gitHeadOutput}`,
    );

    const cliSourcePath = path.join(
      backstageRepoPath,
      'packages',
      'cli',
      'src',
    );

    if (!(await fs.pathExists(cliSourcePath))) {
      throw new Error(
        `CLI source files not found at ${cliSourcePath}. The repository structure may have changed.`,
      );
    }

    console.log('📦 Installing dependencies in Backstage repository...');
    // Install dependencies in the cloned repository
    execSync('yarn install', {
      cwd: backstageRepoPath,
      stdio: 'inherit',
    });
    console.log('✅ Dependencies installed successfully');

    console.log('🔧 Running TypeScript compilation to generate types...');
    // Run TypeScript compilation to generate dist-types
    execSync('yarn tsc', {
      cwd: backstageRepoPath,
      stdio: 'inherit',
    });
    console.log('✅ TypeScript compilation completed');

    const configFile = path.resolve(__dirname, 'backstage-types-config.json');
    const config = await fs.readJson(configFile);

    let typesContent = `
/*
 * Auto-generated TypeScript declarations for @backstage/cli-module-build
 * ${backstageVersionCommentPrefix} ${backstageCliVersion}
 * Generated on: ${new Date().toISOString()}
 *
 * DO NOT EDIT THIS FILE MANUALLY - it will be overwritten
 * Run 'yarn generate-types' to regenerate
 *
 * Types are extracted from packages/cli-module-build in the Backstage monorepo
 * (same commit as the pinned @backstage/cli), via root \`yarn tsc\`.
 */

`;

    const modulesByName = new Map(
      config.modules.map(module => [module.name, module]),
    );
    const pendingModules = [...config.modules];
    const processedModules = new Map();

    while (pendingModules.length > 0) {
      const module = pendingModules.shift();
      if (processedModules.has(module.name)) {
        continue;
      }

      const moduleTypesPath = path.resolve(backstageRepoPath, module.types);
      if (!(await fs.pathExists(moduleTypesPath))) {
        throw new Error(`No types found at: ${moduleTypesPath}`);
      }

      console.log(`📋 Found types at: ${moduleTypesPath}`);
      const moduleTypes = formatModuleTypes(
        await fs.readFile(moduleTypesPath, 'utf8'),
        moduleTypesPath,
      );
      processedModules.set(module.name, moduleTypes);

      for (const importedModuleName of collectCliModuleBuildImports(
        moduleTypes,
      )) {
        if (
          modulesByName.has(importedModuleName) ||
          processedModules.has(importedModuleName)
        ) {
          continue;
        }

        const importedModule = {
          name: importedModuleName,
          types: moduleNameToTypesPath(importedModuleName),
        };
        modulesByName.set(importedModuleName, importedModule);
        pendingModules.push(importedModule);
      }
    }

    for (const [moduleName, moduleTypes] of processedModules) {
      typesContent += `
declare module '${moduleName}' {
${moduleTypes
  .split('\n')
  .map(line => `  ${line}`)
  .join('\n')}
}

`;
    }

    await fs.writeFile(outputFile, typesContent);
    console.log(
      '✅ Generated backstage-cli-types.d.ts from real Backstage TypeScript compilation',
    );
    success = true;
  } finally {
    if (success) {
      // Clean up temp directory
      await fs.remove(tempDir);
    }
  }

  console.log('🎉 Type generation complete!');
}

generateBackstageTypes();

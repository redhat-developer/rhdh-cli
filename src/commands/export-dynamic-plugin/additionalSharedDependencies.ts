import { BackstagePackageJson } from '@backstage/cli-node';

export const loadAdditionalSharedDependencies = (
  packageJson: BackstagePackageJson,
) => ({
  '@backstage/core-components': {
    singleton: false,
    eager: false,
    requiredVersion: '*',
  },
  '@backstage/frontend-plugin-api': {
    singleton: false,
    eager: false,
    requiredVersion: '*',
  },
  '@backstage/core-plugin-api': {
    singleton: false,
    eager: false,
    requiredVersion: '*',
  },
  zod: {
    singleton: false,
    eager: false,
    requiredVersion: fromPackage(packageJson, 'zod'),
  },
  'zod/': {
    singleton: false,
    eager: false,
    requiredVersion: fromPackage(packageJson, 'zod'),
  },
  'zod-to-json-schema': {
    singleton: false,
    eager: false,
    requiredVersion: fromPackage(packageJson, 'zod-to-json-schema'),
  },
  lodash: {
    singleton: false,
    eager: false,
    requiredVersion: fromPackage(packageJson, 'lodash'),
  },
  'lodash/': {
    singleton: false,
    eager: false,
    requiredVersion: fromPackage(packageJson, 'lodash'),
  },
  parse5: {
    singleton: false,
    eager: false,
    requiredVersion: fromPackage(packageJson, 'parse5'),
  },
  '@material-ui/core': {
    singleton: false,
    eager: false,
    requiredVersion: fromPackage(packageJson, '@material-ui/core'),
  },
});

/**
 * Semver range from package.json for MF requiredVersion. Returns undefined at
 * runtime for transitive-only deps so SharedManager infers ^${installedVersion}.
 */
function fromPackage(
  packageJson: BackstagePackageJson,
  dependencyName: string,
): string {
  for (const section of [
    'dependencies',
    'peerDependencies',
    'devDependencies',
    'optionalDependencies',
  ] as const) {
    const deps = packageJson[section];
    if (deps && dependencyName in deps) {
      return deps[dependencyName];
    }
  }
  // Backstage types require string, but MF allows omitting requiredVersion
  // so that SharedManager can infer ^${installedVersion}.
  // That's why we return undefined and cast to string for transitive deps.
  return undefined as unknown as string;
}

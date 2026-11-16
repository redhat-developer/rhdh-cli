import { BackstagePackageJson } from '@backstage/cli-node';

/**
 * Additional shared dependencies for RHDH dynamic plugin frontend builds.
 *
 * Wildcard entries (`requiredVersion: '*'`) declare that the RHDH host
 * eagerly provides the package, so the host's copy always satisfies the
 * request — bundling a fallback alongside such a declaration is incoherent
 * hedging, dead weight on every RHDH host (the core-components fallback
 * alone drags ~2.5–3 MB of dead async chunks plus the remote entry's chunk
 * table). They therefore set `import: false`.
 *
 * Range-pinned entries (`fromPackage`) are genuine version-mismatch
 * insurance on hosts that provide a different version — they keep their
 * fallbacks.
 */
export const loadAdditionalSharedDependencies = (
  packageJson: BackstagePackageJson,
) => ({
  '@backstage/core-components': {
    singleton: false,
    eager: false,
    requiredVersion: '*',
    import: false as const,
  },
  '@backstage/frontend-plugin-api': {
    singleton: false,
    eager: false,
    requiredVersion: '*',
    import: false as const,
  },
  '@backstage/core-plugin-api': {
    singleton: false,
    eager: false,
    requiredVersion: '*',
    import: false as const,
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

export interface RhdhProfile {
  templatePackageVersion: string;
  packageManager: string;
  devDependencies: Record<string, string>;
  resolutions: Record<string, string>;
  templateRoleOverlays: Record<string, RhdhProfileOverlay>;
}

/** Dependencies and resolutions needed only by a specific upstream template role. */
export interface RhdhProfileOverlay {
  devDependencies?: Record<string, string>;
  resolutions?: Record<string, string>;
}

export interface RhdhProfileDefinition extends Partial<RhdhProfile> {
  extends?: string;
}

export const rhdhProfiles: Record<string, RhdhProfileDefinition> = {
  '2.1.0': {
    // The upstream templates are coupled to this Backstage release line.
    templatePackageVersion: '0.1.6',
    packageManager: 'yarn@4.17.1',
    devDependencies: {
      '@backstage/cli-defaults': '0.1.5',
      // The CLI's Jest peer accepts v29; matching its environment avoids peer warnings.
      jest: '^29.7.0',
      'jest-environment-jsdom': '^29.7.0',
      '@types/jest': '^29.5.14',
      typescript: '5.4.5',
    },
    resolutions: {
      // Direct Backstage dependencies are pinned from the release manifest;
      // transitives follow the ranges published by upstream packages.
      // Newer express type packages are incompatible with the RHDH 2.1 toolchain.
      '@types/express': '4.17.21',
    },
    // Keep frontend development dependencies out of backend and module projects.
    templateRoleOverlays: {
      'frontend-plugin': {
        devDependencies: {
          // frontend-test-utils requires Testing Library v16 or later.
          '@testing-library/react': '^16.0.0',
          '@types/react': '^18.0.0',
          '@types/react-dom': '^18.0.0',
          // frontend-dev-utils declares these as peers for the standalone dev app.
          'react-dom': '^18.0.0',
          'react-router-dom': '^6.30.2',
        },
      },
    },
  },
};

/**
 * Resolves a profile's parent before applying its scalar and dependency-map
 * overrides. Dependency maps, including template-role overlays, are merged so
 * a patch profile only needs to list packages it changes.
 */
export function resolveRhdhProfile(
  profiles: Record<string, RhdhProfileDefinition>,
  profileName: string,
  resolving: string[] = [],
): RhdhProfile {
  const definition = profiles[profileName];
  if (!definition) {
    throw new Error(`RHDH profile "${profileName}" does not exist.`);
  }
  if (resolving.includes(profileName)) {
    throw new Error(
      `RHDH profile inheritance cycle: ${[...resolving, profileName].join(' -> ')}.`,
    );
  }

  const parent = definition.extends
    ? resolveRhdhProfile(profiles, definition.extends, [
        ...resolving,
        profileName,
      ])
    : undefined;
  return {
    templatePackageVersion:
      definition.templatePackageVersion ?? parent?.templatePackageVersion ?? '',
    packageManager: definition.packageManager ?? parent?.packageManager ?? '',
    devDependencies: {
      ...parent?.devDependencies,
      ...definition.devDependencies,
    },
    resolutions: {
      ...parent?.resolutions,
      ...definition.resolutions,
    },
    templateRoleOverlays: Object.fromEntries(
      Object.entries({
        ...parent?.templateRoleOverlays,
        ...definition.templateRoleOverlays,
      }).map(([role, overlay]) => [
        role,
        {
          devDependencies: {
            ...parent?.templateRoleOverlays[role]?.devDependencies,
            ...overlay.devDependencies,
          },
          resolutions: {
            ...parent?.templateRoleOverlays[role]?.resolutions,
            ...overlay.resolutions,
          },
        },
      ]),
    ),
  };
}

/** Applies dependencies required by the role declared in an upstream template. */
export function applyRhdhTemplateRoleOverlay(
  profile: RhdhProfile,
  templateRole: string,
): Omit<RhdhProfile, 'templateRoleOverlays'> {
  const overlay = profile.templateRoleOverlays[templateRole];
  return {
    templatePackageVersion: profile.templatePackageVersion,
    packageManager: profile.packageManager,
    devDependencies: {
      ...profile.devDependencies,
      ...overlay?.devDependencies,
    },
    resolutions: {
      ...profile.resolutions,
      ...overlay?.resolutions,
    },
  };
}

export function getRhdhProfile(rhdhVersion: string): RhdhProfile {
  const [major, minor] = rhdhVersion.split('.');
  const baseline = `${major}.${minor}.0`;
  // A patch profile is opt-in; unlisted patches use their minor-line baseline.
  const profileName = rhdhProfiles[rhdhVersion] ? rhdhVersion : baseline;
  if (!rhdhProfiles[profileName]) {
    throw new Error(
      `Plugin creation supports RHDH ${Object.keys(rhdhProfiles)
        .filter(version => version.endsWith('.0'))
        .map(version => version.split('.').slice(0, 2).join('.'))
        .join(', ')} only.`,
    );
  }
  return resolveRhdhProfile(rhdhProfiles, profileName);
}

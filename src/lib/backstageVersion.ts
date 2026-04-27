/*
 * Copyright 2024 The Backstage Authors
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

/**
 * This module provides utilities for resolving `backstage:^` version specs
 * to concrete versions using the Backstage release manifests.
 *
 * It replicates the logic from the Backstage yarn plugin's beforeWorkspacePacking
 * hook, which is not directly importable since the yarn plugin is private and
 * bundled specifically for Yarn's plugin system.
 *
 * Environment variables (compatible with the Backstage yarn plugin):
 * - BACKSTAGE_MANIFEST_FILE: Path to a local manifest file (for offline usage)
 * - BACKSTAGE_VERSIONS_BASE_URL: Custom base URL for fetching manifests
 */

import { BACKSTAGE_JSON } from '@backstage/cli-common';
import {
  getManifestByVersion,
  ReleaseManifest,
} from '@backstage/release-manifests';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as semver from 'semver';

import { paths } from './paths';

const PROTOCOL = 'backstage:';

/**
 * Cache for the release manifest to avoid fetching it multiple times
 */
let cachedManifest:
  | { version: string; packages: Map<string, string> }
  | undefined;

/**
 * Gets the current Backstage version from backstage.json
 */
export async function getCurrentBackstageVersion(): Promise<
  string | undefined
> {
  // Try to find backstage.json in the target directory or monorepo root
  const possiblePaths = [
    path.join(paths.targetDir, BACKSTAGE_JSON),
    path.join(paths.targetRoot, BACKSTAGE_JSON),
  ];

  for (const backstageJsonPath of possiblePaths) {
    if (await fs.pathExists(backstageJsonPath)) {
      try {
        const backstageJson = await fs.readJson(backstageJsonPath);
        const version = backstageJson.version;
        if (version && semver.valid(version)) {
          return version;
        }
      } catch {
        // Continue to next path
      }
    }
  }

  return undefined;
}

/**
 * Fetches and caches the Backstage release manifest for the given version.
 *
 * Supports the same environment variables as the Backstage yarn plugin:
 * - BACKSTAGE_MANIFEST_FILE: Read manifest from a local file instead of fetching
 * - BACKSTAGE_VERSIONS_BASE_URL: Custom base URL for fetching manifests
 */
async function getBackstageManifest(
  backstageVersion: string,
): Promise<Map<string, string>> {
  if (cachedManifest && cachedManifest.version === backstageVersion) {
    return cachedManifest.packages;
  }

  let manifest: ReleaseManifest;

  // Support BACKSTAGE_MANIFEST_FILE for offline usage (same as yarn plugin)
  const manifestFile = process.env.BACKSTAGE_MANIFEST_FILE;
  if (manifestFile) {
    try {
      manifest = await fs.readJson(manifestFile);
    } catch (error) {
      throw new Error(
        `Failed to read Backstage manifest from BACKSTAGE_MANIFEST_FILE="${manifestFile}": ${error}`,
      );
    }
  } else {
    try {
      manifest = await getManifestByVersion({
        version: backstageVersion,
        // Support BACKSTAGE_VERSIONS_BASE_URL for custom manifest server (same as yarn plugin)
        versionsBaseUrl: process.env.BACKSTAGE_VERSIONS_BASE_URL,
      });
    } catch (error) {
      const baseUrl =
        process.env.BACKSTAGE_VERSIONS_BASE_URL ||
        'https://versions.backstage.io';
      throw new Error(
        `Failed to fetch Backstage release manifest for version ${backstageVersion} from ${baseUrl}: ${error}\n\n` +
          `To resolve this issue, you can:\n` +
          `  - Check your network connection\n` +
          `  - Set BACKSTAGE_VERSIONS_BASE_URL to use a different manifest server\n` +
          `  - Set BACKSTAGE_MANIFEST_FILE to use a local manifest file for offline usage\n` +
          `    (Download from: ${baseUrl}/v1/releases/${backstageVersion}/manifest.json)`,
      );
    }
  }

  const packages = new Map<string, string>();
  for (const pkg of manifest.packages) {
    packages.set(pkg.name, pkg.version);
  }

  cachedManifest = { version: backstageVersion, packages };
  return packages;
}

/**
 * Checks if a version spec uses the backstage: protocol
 */
export function isBackstageVersionSpec(versionSpec: string): boolean {
  return versionSpec.startsWith(PROTOCOL);
}

/**
 * Resolves a backstage:^ version spec to a concrete version.
 *
 * @param packageName - The name of the package to resolve
 * @param versionSpec - The version spec (e.g., "backstage:^")
 * @returns The resolved version (e.g., "^1.23.0") or undefined if not found
 */
export async function resolveBackstageVersion(
  packageName: string,
  versionSpec: string,
): Promise<string | undefined> {
  if (!isBackstageVersionSpec(versionSpec)) {
    return undefined;
  }

  const selector = versionSpec.slice(PROTOCOL.length);
  if (selector !== '^') {
    throw new Error(
      `Unsupported backstage: version selector "${selector}" for package "${packageName}". Only "backstage:^" is supported.`,
    );
  }

  const backstageVersion = await getCurrentBackstageVersion();
  if (!backstageVersion) {
    throw new Error(
      `Cannot resolve "${versionSpec}" for package "${packageName}": ` +
        `No backstage.json file found with a valid version. ` +
        `Make sure backstage.json exists in the project or monorepo root.`,
    );
  }

  const manifest = await getBackstageManifest(backstageVersion);
  const resolvedVersion = manifest.get(packageName);

  if (!resolvedVersion) {
    throw new Error(
      `Package "${packageName}" not found in Backstage release manifest for version ${backstageVersion}. ` +
        `This package may not be part of the Backstage release, or may have been renamed/removed. ` +
        `You may need to specify an explicit version instead of "${versionSpec}".`,
    );
  }

  return `^${resolvedVersion}`;
}

/**
 * Clears the cached manifest (useful for testing)
 */
export function clearManifestCache(): void {
  cachedManifest = undefined;
}

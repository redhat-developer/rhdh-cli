/*
 * Copyright 2026 The Backstage Authors
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

import semver from 'semver';
import {
  getBackstageManifest,
  getCurrentBackstageVersion,
} from './backstageVersion';

/**
 * Static embedded compatibility matrix between RHDH releases and Backstage releases.
 * Used for offline/air-gapped operations and as a fallback when remote metadata lookup is unavailable.
 */
export const RHDH_COMPATIBILITY_MATRIX: Record<string, string> = {
  '2.1.0': '1.52.0',
  '2.0.4': '1.52.0',
  '2.0.0': '1.52.0',
  '1.10.0': '1.49.4',
  '1.9.0': '1.45.3',
  '1.8.0': '1.42.5',
  '1.7.0': '1.39.1',
  '1.6.0': '1.36.1',
  main: '1.52.0',
  next: '1.52.0',
};

/**
 * Default stable RHDH GA release version
 */
export const DEFAULT_RHDH_VERSION = '2.0.0';

export type RhdhVersionSource = 'remote' | 'matrix';

export interface ResolveRhdhVersionOptions {
  manifestFile?: string;
  versionsBaseUrl?: string;
  offline?: boolean;
}

export interface ResolvedRhdhVersion {
  rhdhVersion: string;
  backstageVersion: string;
  packages: Map<string, string>;
  source: RhdhVersionSource;
}

/**
 * Cache for resolved RHDH versions
 */
let cachedRhdhVersions = new Map<string, ResolvedRhdhVersion>();

/**
 * Normalizes input RHDH version string
 */
export function normalizeRhdhVersion(input?: string): string {
  if (!input) {
    return DEFAULT_RHDH_VERSION;
  }

  const trimmed = input.trim().toLowerCase();

  if (trimmed === 'latest' || trimmed === 'stable') {
    return DEFAULT_RHDH_VERSION;
  }

  if (trimmed === 'next' || trimmed === 'main') {
    return 'main';
  }

  // Strip leading 'v' or 'v.'
  return trimmed.replace(/^v\.?/, '');
}

/**
 * Maps an RHDH version or branch name to a GitHub repository ref/branch in redhat-developer/rhdh
 */
export function getRhdhGitRef(version: string): string {
  if (version === 'main' || version === 'next') {
    return 'main';
  }

  // For versions like 2.0.0, 2.0, 1.9.0, extract major.minor for release branch (e.g. release-2.0)
  const parsed = semver.coerce(version);
  if (parsed) {
    return `release-${parsed.major}.${parsed.minor}`;
  }

  return `release-${version}`;
}

/**
 * Fetches build-metadata.json from target RHDH repository release branch
 */
export async function fetchRemoteRhdhMetadata(
  rhdhVersion: string,
  options?: { timeoutMs?: number; baseUrl?: string },
): Promise<{ rhdhVersion: string; backstageVersion: string } | undefined> {
  const gitRef = getRhdhGitRef(rhdhVersion);
  const baseUrl =
    options?.baseUrl ||
    process.env.RHDH_METADATA_BASE_URL ||
    'https://raw.githubusercontent.com/redhat-developer/rhdh';
  const metadataUrl = `${baseUrl}/${gitRef}/packages/app/src/build-metadata.json`;

  const timeoutMs = options?.timeoutMs ?? 3000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(metadataUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return undefined;
    }

    const data = (await response.json()) as any;
    const bsVersion =
      data?.card?.['Backstage Version'] ||
      data?.card?.backstageVersion ||
      data?.backstageVersion;

    const resolvedRhdhVersion =
      data?.card?.['RHDH Version'] ||
      data?.card?.rhdhVersion ||
      data?.rhdhVersion ||
      rhdhVersion;

    if (bsVersion && typeof bsVersion === 'string') {
      const validBsVersion = semver.clean(bsVersion) || bsVersion.trim();
      return {
        rhdhVersion: resolvedRhdhVersion,
        backstageVersion: validBsVersion,
      };
    }
  } catch {
    // Network error, abort timeout, or invalid JSON: fall back to matrix
    return undefined;
  } finally {
    clearTimeout(timeoutId);
  }

  return undefined;
}

/**
 * Finds Backstage version in static compatibility matrix
 */
export function findStaticMatrixBackstageVersion(
  rhdhVersion: string,
): string | undefined {
  if (RHDH_COMPATIBILITY_MATRIX[rhdhVersion]) {
    return RHDH_COMPATIBILITY_MATRIX[rhdhVersion];
  }

  // Exact semver match or minor version resolution (e.g. "2.0" -> "2.0.0")
  const parsed = semver.coerce(rhdhVersion);
  if (parsed) {
    // Check exact coerced version (e.g., 2.0 -> 2.0.0)
    const exact = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
    if (RHDH_COMPATIBILITY_MATRIX[exact]) {
      return RHDH_COMPATIBILITY_MATRIX[exact];
    }

    // Check minor version pattern match across matrix
    for (const [verKey, bsVer] of Object.entries(RHDH_COMPATIBILITY_MATRIX)) {
      const keyParsed = semver.coerce(verKey);
      if (
        keyParsed &&
        keyParsed.major === parsed.major &&
        keyParsed.minor === parsed.minor
      ) {
        return bsVer;
      }
    }
  }

  return undefined;
}

/**
 * Returns a list of all supported RHDH versions
 */
export function getSupportedRhdhVersions(): string[] {
  const versions = Object.keys(RHDH_COMPATIBILITY_MATRIX).filter(
    k => k !== 'main' && k !== 'next',
  );
  return Array.from(new Set(versions)).sort((a, b) => {
    const sA = semver.coerce(a);
    const sB = semver.coerce(b);
    if (sA && sB) {
      return semver.rcompare(sA, sB);
    }
    return b.localeCompare(a);
  });
}

/**
 * Resolves default target RHDH version by inspecting current backstage.json
 */
async function getDefaultTargetVersion(): Promise<string | undefined> {
  const currentBsVersion = await getCurrentBackstageVersion();
  if (!currentBsVersion) {
    return undefined;
  }
  for (const [rVer, bsVer] of Object.entries(RHDH_COMPATIBILITY_MATRIX)) {
    if (bsVer === currentBsVersion && rVer !== 'main' && rVer !== 'next') {
      return rVer;
    }
  }
  return undefined;
}

/**
 * Resolves Backstage version using remote metadata or static compatibility matrix
 */
async function resolveBackstageVersionForRhdh(
  normalized: string,
  isOffline: boolean,
): Promise<
  | {
      backstageVersion: string;
      resolvedRhdhVersion: string;
      source: RhdhVersionSource;
    }
  | undefined
> {
  if (!isOffline) {
    const remote = await fetchRemoteRhdhMetadata(normalized);
    if (remote) {
      return {
        backstageVersion: remote.backstageVersion,
        resolvedRhdhVersion: remote.rhdhVersion,
        source: 'remote',
      };
    }
  }

  const backstageVersion = findStaticMatrixBackstageVersion(normalized);
  if (backstageVersion) {
    return {
      backstageVersion,
      resolvedRhdhVersion: normalized,
      source: 'matrix',
    };
  }

  return undefined;
}

/**
 * Resolves an RHDH version query to its underlying Backstage version and package release manifest.
 *
 * 3-tier resolution:
 * 1. Remote metadata lookup (fetching build-metadata.json from GitHub branch/tag)
 * 2. Static compatibility matrix fallback (for offline or unknown remote)
 * 3. Backstage release manifest fetch (via @backstage/release-manifests or local manifest file)
 */
export async function resolveRhdhVersion(
  rhdhVersionInput?: string,
  options?: ResolveRhdhVersionOptions,
): Promise<ResolvedRhdhVersion> {
  const targetVersion = rhdhVersionInput || (await getDefaultTargetVersion());
  const normalized = normalizeRhdhVersion(targetVersion);
  const cacheKey = `${normalized}:${options?.manifestFile || ''}:${options?.offline || ''}`;

  const cached = cachedRhdhVersions.get(cacheKey);
  if (cached) {
    return cached;
  }

  const isOffline =
    options?.offline ||
    process.env.RHDH_OFFLINE === 'true' ||
    Boolean(options?.manifestFile || process.env.BACKSTAGE_MANIFEST_FILE);

  const resolved = await resolveBackstageVersionForRhdh(normalized, isOffline);
  if (!resolved) {
    const supported = getSupportedRhdhVersions().join(', ');
    throw new Error(
      `Unsupported or unknown RHDH version "${rhdhVersionInput}". ` +
        `Supported versions are: ${supported} (or 'latest', 'next', 'main').`,
    );
  }

  const packages = await getBackstageManifest(resolved.backstageVersion, {
    manifestFile: options?.manifestFile,
    versionsBaseUrl: options?.versionsBaseUrl,
  });

  const result: ResolvedRhdhVersion = {
    rhdhVersion: resolved.resolvedRhdhVersion,
    backstageVersion: resolved.backstageVersion,
    packages,
    source: resolved.source,
  };

  cachedRhdhVersions.set(cacheKey, result);
  return result;
}

/**
 * Clears cached RHDH versions (useful for tests)
 */
export function clearRhdhVersionCache(): void {
  cachedRhdhVersions = new Map();
}

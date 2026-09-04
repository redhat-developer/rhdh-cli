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

import { clearManifestCache } from './backstageVersion';
import {
  clearRhdhVersionCache,
  DEFAULT_RHDH_VERSION,
  fetchRemoteRhdhMetadata,
  findStaticMatrixBackstageVersion,
  getRhdhGitRef,
  getSupportedRhdhVersions,
  normalizeRhdhVersion,
  resolveRhdhVersion,
} from './rhdhVersion';

describe('rhdhVersion', () => {
  const originalFetch = globalThis.fetch;

  function setupFetchMock({
    metadata,
    metadataError,
    manifestVersion = '1.52.0',
    packages = [],
    manifestError,
  }: {
    metadata?: any;
    metadataError?: Error;
    manifestVersion?: string;
    packages?: { name: string; version: string }[];
    manifestError?: Error;
  } = {}) {
    const fn = jest.fn().mockImplementation((url: string) => {
      if (url.includes('build-metadata.json')) {
        if (metadataError) return Promise.reject(metadataError);
        if (metadata) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => metadata,
          } as any);
        }
        return Promise.resolve({ ok: false, status: 404 } as any);
      }
      if (url.includes('manifest.json')) {
        if (manifestError) return Promise.reject(manifestError);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            releaseVersion: manifestVersion,
            packages,
          }),
        } as any);
      }
      return Promise.reject(new Error(`Unexpected url: ${url}`));
    });
    globalThis.fetch = fn;
    return fn;
  }

  beforeEach(() => {
    clearRhdhVersionCache();
    clearManifestCache();
    delete process.env.RHDH_OFFLINE;
    delete process.env.BACKSTAGE_MANIFEST_FILE;
    delete process.env.BACKSTAGE_VERSIONS_BASE_URL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('normalizeRhdhVersion', () => {
    it('returns default version when no input provided', () => {
      expect(normalizeRhdhVersion()).toBe(DEFAULT_RHDH_VERSION);
      expect(normalizeRhdhVersion('')).toBe(DEFAULT_RHDH_VERSION);
    });

    it('normalizes latest and stable aliases', () => {
      expect(normalizeRhdhVersion('latest')).toBe(DEFAULT_RHDH_VERSION);
      expect(normalizeRhdhVersion('STABLE')).toBe(DEFAULT_RHDH_VERSION);
    });

    it('normalizes next and main aliases', () => {
      expect(normalizeRhdhVersion('next')).toBe('main');
      expect(normalizeRhdhVersion('main')).toBe('main');
    });

    it('preserves backstage: prefix', () => {
      expect(normalizeRhdhVersion('backstage:1.54.0')).toBe('backstage:1.54.0');
    });

    it('strips leading v from version strings', () => {
      expect(normalizeRhdhVersion('v2.0.0')).toBe('2.0.0');
      expect(normalizeRhdhVersion('V1.9.0')).toBe('1.9.0');
      expect(normalizeRhdhVersion('v2.0')).toBe('2.0');
    });
  });

  describe('getRhdhGitRef', () => {
    it('maps main and next to main branch', () => {
      expect(getRhdhGitRef('main')).toBe('main');
      expect(getRhdhGitRef('next')).toBe('main');
    });

    it('maps semver releases to release-X.Y branches', () => {
      expect(getRhdhGitRef('2.0.0')).toBe('release-2.0');
      expect(getRhdhGitRef('2.0')).toBe('release-2.0');
      expect(getRhdhGitRef('1.9.0')).toBe('release-1.9');
      expect(getRhdhGitRef('1.10.0')).toBe('release-1.10');
    });
  });

  describe('findStaticMatrixBackstageVersion', () => {
    it('finds exact versions in matrix', () => {
      expect(findStaticMatrixBackstageVersion('2.0.0')).toBe('1.52.0');
      expect(findStaticMatrixBackstageVersion('1.9.0')).toBe('1.45.3');
      expect(findStaticMatrixBackstageVersion('1.8.0')).toBe('1.42.5');
      expect(findStaticMatrixBackstageVersion('main')).toBe('1.54.0');
    });

    it('resolves minor versions without patch to matrix entry', () => {
      expect(findStaticMatrixBackstageVersion('2.0')).toBe('1.52.0');
      expect(findStaticMatrixBackstageVersion('1.9')).toBe('1.45.3');
      expect(findStaticMatrixBackstageVersion('1.10')).toBe('1.49.4');
    });

    it('returns undefined for unknown versions', () => {
      expect(findStaticMatrixBackstageVersion('0.1.0')).toBeUndefined();
      expect(findStaticMatrixBackstageVersion('unknown')).toBeUndefined();
    });
  });

  describe('getSupportedRhdhVersions', () => {
    it('returns unique sorted supported versions list', () => {
      const versions = getSupportedRhdhVersions();
      expect(versions).toContain('2.0.0');
      expect(versions).toContain('1.9.0');
      expect(versions).not.toContain('main');
      expect(versions).not.toContain('next');
    });
  });

  describe('fetchRemoteRhdhMetadata', () => {
    it('fetches and parses remote build-metadata.json successfully', async () => {
      setupFetchMock({
        metadata: {
          card: {
            'RHDH Version': '2.0.0',
            'Backstage Version': '1.52.0',
          },
        },
      });

      const result = await fetchRemoteRhdhMetadata('2.0.0');
      expect(result).toEqual({
        rhdhVersion: '2.0.0',
        backstageVersion: '1.52.0',
      });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/redhat-developer/rhdh/release-2.0/packages/app/src/build-metadata.json',
        expect.anything(),
      );
    });

    it('handles HTTP error gracefully by returning undefined', async () => {
      setupFetchMock({});

      const result = await fetchRemoteRhdhMetadata('9.9.9');
      expect(result).toBeUndefined();
    });

    it('handles network failure / fetch exception gracefully', async () => {
      setupFetchMock({ metadataError: new Error('Network error') });

      const result = await fetchRemoteRhdhMetadata('2.0.0');
      expect(result).toBeUndefined();
    });
  });

  describe('resolveRhdhVersion', () => {
    it('resolves remote metadata when available (Tier 1)', async () => {
      setupFetchMock({
        metadata: {
          card: {
            'RHDH Version': '2.0.0',
            'Backstage Version': '1.52.0',
          },
        },
        packages: [{ name: '@backstage/core-plugin-api', version: '1.12.0' }],
      });

      const resolved = await resolveRhdhVersion('2.0.0');
      expect(resolved.rhdhVersion).toBe('2.0.0');
      expect(resolved.backstageVersion).toBe('1.52.0');
      expect(resolved.source).toBe('remote');
      expect(resolved.packages.get('@backstage/core-plugin-api')).toBe(
        '1.12.0',
      );
    });

    it('resolves direct Backstage version when requested', async () => {
      setupFetchMock({
        manifestVersion: '1.54.0',
        packages: [{ name: '@backstage/core-plugin-api', version: '1.14.0' }],
      });

      const resolved = await resolveRhdhVersion('backstage:1.54.0');
      expect(resolved.backstageVersion).toBe('1.54.0');
      expect(resolved.rhdhVersion).toBe('backstage:1.54.0');
      expect(resolved.packages.get('@backstage/core-plugin-api')).toBe(
        '1.14.0',
      );
    });

    it('resolves raw Backstage version string', async () => {
      setupFetchMock({
        manifestVersion: '1.54.0',
        packages: [{ name: '@backstage/core-plugin-api', version: '1.14.0' }],
      });

      const resolved = await resolveRhdhVersion('1.54.0');
      expect(resolved.backstageVersion).toBe('1.54.0');
      expect(resolved.rhdhVersion).toBe('backstage:1.54.0');
    });

    it('falls back to static compatibility matrix (Tier 2) when remote fails', async () => {
      setupFetchMock({
        metadataError: new Error('Network unreachable'),
        manifestVersion: '1.45.3',
        packages: [{ name: '@backstage/core-plugin-api', version: '1.10.9' }],
      });

      const resolved = await resolveRhdhVersion('1.9.0');
      expect(resolved.rhdhVersion).toBe('1.9.0');
      expect(resolved.backstageVersion).toBe('1.45.3');
      expect(resolved.source).toBe('matrix');
      expect(resolved.packages.get('@backstage/core-plugin-api')).toBe(
        '1.10.9',
      );
    });

    it('skips remote lookup when offline option is provided', async () => {
      const fetchMock = setupFetchMock({
        manifestVersion: '1.52.0',
        packages: [],
      });

      const resolved = await resolveRhdhVersion('2.0.0', { offline: true });
      expect(resolved.source).toBe('matrix');
      expect(fetchMock).not.toHaveBeenCalledWith(
        expect.stringContaining('build-metadata.json'),
        expect.anything(),
      );
    });

    it('throws descriptive error on unknown RHDH version', async () => {
      setupFetchMock({});

      await expect(resolveRhdhVersion('999.0.0')).rejects.toThrow(
        /Unsupported or unknown RHDH version "999.0.0"/,
      );
    });

    it('caches resolution results on consecutive calls', async () => {
      const fetchMock = setupFetchMock({
        metadata: {
          card: {
            'RHDH Version': '2.0.0',
            'Backstage Version': '1.52.0',
          },
        },
      });

      const res1 = await resolveRhdhVersion('2.0.0');
      const res2 = await resolveRhdhVersion('2.0.0');

      expect(res1).toBe(res2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});

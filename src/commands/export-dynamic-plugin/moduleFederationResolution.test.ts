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

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

import { resolveCliModuleBuildConfig } from './moduleFederationResolution';

describe('explicit devDependency alignment', () => {
  /**
   * moduleFederationOverrides.ts statically imports types from
   * `@module-federation/sdk`, `@module-federation/rspack/plugin` and
   * `@rspack/core` — exact-pinned devDependencies. They must resolve to
   * the same package instances the build actually loads through the
   * anchored cli-module-build chain, or the typed contract drifts from
   * runtime behavior. After a backstage bump moves the MF toolchain,
   * this fails until the pins are updated to the resolved versions.
   */
  it('resolves the same instances the cli-module-build chain uses', () => {
    // What the static type imports resolve:
    const requireAsCli = createRequire(__filename);
    // What the build actually loads, via the anchored chain:
    const requireAsConfig = createRequire(resolveCliModuleBuildConfig());
    const requireAsEnhanced = createRequire(
      requireAsConfig.resolve('@module-federation/enhanced/rspack'),
    );

    const assertSameInstance = (
      specifier: string,
      resolveRuntime: () => string,
    ) => {
      expect(fs.realpathSync(requireAsCli.resolve(specifier))).toBe(
        fs.realpathSync(resolveRuntime()),
      );
    };

    assertSameInstance('@module-federation/sdk', () =>
      requireAsEnhanced.resolve('@module-federation/sdk'),
    );
    assertSameInstance('@module-federation/rspack/plugin', () =>
      requireAsEnhanced.resolve('@module-federation/rspack/plugin'),
    );
    assertSameInstance('@rspack/core', () =>
      requireAsConfig.resolve('@rspack/core'),
    );
  });

  /**
   * A `~2.8.0` range once resolved to a newer patch release, hoisted a
   * second copy at top level, and changed the classic remoteEntry past
   * its e2e size bound. Keep the pins exact so a single instance is
   * installed.
   */
  it('pins the explicit MF and rspack devDependencies exactly', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../../package.json'),
        'utf-8',
      ),
    );
    for (const name of [
      '@module-federation/sdk',
      '@module-federation/rspack',
      '@rspack/core',
    ]) {
      expect(packageJson.devDependencies[name]).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

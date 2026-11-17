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

/**
 * The resolution anchor for the Module Federation build toolchain:
 * resolving MF and rspack packages through `@backstage/cli-module-build`'s
 * bundler config — the module that drives the build — guarantees the
 * instances match what the build itself loads, regardless of
 * node_modules hoisting. Used by the plugin wrapper installer
 * (`moduleFederationOverrides`), the shared runtime builder
 * (`buildSharedRuntime`), and the devDependency-alignment tests.
 */
export function resolveCliModuleBuildConfig(): string {
  const requireFromHere = createRequire(__filename);
  return requireFromHere.resolve(
    '@backstage/cli-module-build/dist/lib/bundler/config.cjs.js',
  );
}

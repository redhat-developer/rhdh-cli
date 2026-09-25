# Changelog

All notable changes to `@red-hat-developer-hub/cli` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The major and minor version are synchronized with the corresponding RHDH release (see [Versioning Strategy](README.md#versioning-strategy)).

## [Unreleased]

### Added

- **`plugin dev`:** Add `--watch` to `rhdh-cli plugin dev start`, and a standalone `rhdh-cli plugin dev update --watch`, for continuous re-export/re-stage/restart on source changes ([RHIDP-16673](https://redhat.atlassian.net/browse/RHIDP-16673), [#222](https://github.com/redhat-developer/rhdh-cli/pull/222)). Watches `src/` and `package.json` with a 500ms debounce and serializes cycles so a change arriving mid-cycle queues exactly one follow-up; prints a refresh URL once RHDH responds. `plugin dev start` now also shows phased `[1/4]`–`[4/4]` progress through build/export, runtime start, plugin install, and readiness polling. `plugin dev update` and `plugin dev restart` fail fast with an actionable message when RHDH Local isn't running yet, instead of surfacing a raw compose/container error.

## 2.1.1 - 2026-09-21

### Added

- **`plugin dev`:** New `rhdh-cli plugin dev` command (`start`, `update`, `restart`, `stop`, `logs`, `status`) for exporting a dynamic plugin and managing its lifecycle against an existing [RHDH Local](https://github.com/redhat-developer/rhdh-local) checkout ([RHIDP-16672](https://redhat.atlassian.net/browse/RHIDP-16672), [#215](https://github.com/redhat-developer/rhdh-cli/pull/215)). Use `--rhdh-local-dir <path>` or `RHDH_LOCAL_DIR` to point at the checkout; `--configure` adds the CLI-managed config include on first use. `plugin dev restart` restarts the RHDH service without re-deploying the plugin, useful when changing RHDH Local configuration. `plugin dev logs` accepts `--follow` to stream output continuously, `--rhdh` for RHDH application logs, and `--installer` for plugin installer logs.

### Fixed

- **`plugin new`:** Generated `package.json` now always includes a `version` field (defaults to `0.1.0`). Upstream standalone templates omit it, but `plugin export` and `npm pack` both require a version to produce a valid package tarball.
- **`plugin export`:** Both backend and frontend export paths now validate that `package.json` contains a `version` field before invoking `npm pack`, and emit a clear error instructing users to add one. Plugins without a `version` field would previously fail silently inside the RHDH Local installer container. **Existing plugins that omit `version` will now fail at export time** — add `"version": "0.1.0"` (or higher) to their `package.json`.
- **`plugin export`:** `ensureDir` is now called before writing the config schema file, preventing failures when the parent directory does not exist.

## 2.1.0 - 2026-09-21

### Added

- **`plugin new`:** Add `rhdh-cli plugin new <name>` to create standalone, version-pinned frontend, backend, and catalog processor module dynamic plugin projects. The command renders portable template assets from the release-matched `@backstage/cli-module-new` package (`0.1.6` for RHDH 2.1 / Backstage 1.54.6). The RHDH adapter supplies standalone `backstage.json`, Yarn Berry configuration, TypeScript configuration, RHDH export guidance, and dev harnesses. All `@backstage/*` direct dependencies are pinned from the target release manifest; transitive ranges remain upstream-managed ([RHIDP-16671](https://redhat.atlassian.net/browse/RHIDP-16671), [RHIDP-16668](https://redhat.atlassian.net/browse/RHIDP-16668), [#202](https://github.com/redhat-developer/rhdh-cli/pull/202), [#208](https://github.com/redhat-developer/rhdh-cli/pull/208)).
- **`plugin new --template <name>`:** Select a generated project type using the upstream portable template name (`frontend-plugin`, `backend-plugin`, `catalog-processor-module`) as an alternative to `--type`. Only templates with end-to-end test coverage are accepted. Passing an unsupported template name produces a clear error listing the accepted values.
- **`plugin new --module-id <id>`:** Override the module identifier for module-type templates (e.g. `catalog-processor-module`). Defaults to the plugin name when omitted, preserving non-interactive behaviour.
- **`plugin new --plugin-package <name>`:** Set the generated `package.json` `name` field. Validated against npm package name rules (lowercase, max 214 chars, no whitespace or special characters). Defaults to `@internal/backstage-plugin-<name>`.
- Add intent-based `catalog`, `api`, `search`, `docs`, and `template` command groups for querying and managing RHDH through Backstage actions. These commands support human-readable and JSON output, multi-instance targeting, structured errors, and entity reference disambiguation ([RHIDP-14129](https://redhat.atlassian.net/browse/RHIDP-14129), [#156](https://github.com/redhat-developer/rhdh-cli/pull/156)).

### Changed

- **Frontend plugin export:** Improved module federation sharing configuration to optimize bundle sizes and reduce duplicate dependencies across dynamic plugins. A curated list of common dependencies and transitive dependencies are now shared by default, with version requirements respected when appropriate for better runtime performance ([#216](https://github.com/redhat-developer/rhdh-cli/pull/216)).
- **Frontend plugin export:** Frontend plugins now use Backstage standard module federation exclusively. The generated remote assets are written to `dist/`, including `dist/remoteEntry.js`. Removed the frontend export options `--scalprum-config`, `--generate-scalprum-assets`, `--no-generate-scalprum-assets`, `--generate-module-federation-assets`, and `--no-generate-module-federation-assets`. Frontend module-federation assets are now always generated during `plugin export`. Frontend exports warn when legacy `dist-scalprum/`, `plugin-manifest.json`, or `scalprum` package metadata is still present. The legacy `plugin build` and `plugin start` commands have been removed.
  - Migration guidance: Remove the deleted frontend export options from scripts and CI jobs.
  - Migration guidance: Update integrations that read `dist-scalprum/plugin-manifest.json` to use the standard module-federation output under `dist/` and NFS metadata in `backstage.features`.
  - Migration guidance: Remove `dist-scalprum` and related glob entries from frontend plugin `files` fields and clean any checked-in legacy output before exporting with rhdh-cli 2.1.0 ([#182](https://github.com/redhat-developer/rhdh-cli/pull/182)).
- **`plugin new` (package name convention):** The default generated `package.json` `name` no longer carries a type suffix. Previously, the RHDH-owned backend template appended `-backend` (producing `@internal/backstage-plugin-<name>-backend`) and the catalog processor module template appended a similar suffix; the upstream `@backstage/cli-module-new` templates use a flat `@internal/backstage-plugin-<name>` for all types. Scripts or CI configurations that reference the old type-suffixed name should update accordingly, or pass `--plugin-package @internal/backstage-plugin-<name>-backend` to restore the previous name.

### Fixed

- **`plugin new`:** Add the missing `jest-environment-jsdom` development dependency to generated projects so `yarn test` runs successfully ([#204](https://github.com/redhat-developer/rhdh-cli/pull/204)).
- **`plugin new` (frontend):** Generated frontend plugin tests now pass under Node 18+ without modification. The upstream `@backstage/cli-module-new` 0.1.6 template pinned `msw@1.0.0`, whose `setupServer()` does not intercept `globalThis.fetch` used by Backstage's `fetchApiRef` in tests, causing the generated `TodoPage` test to time out. Three RHDH template overlay files patch the generated project: the test is updated to the MSW v2 API (`http`/`HttpResponse`); `setupTests.ts` exposes the Web API globals (`TextEncoder`, `BroadcastChannel`, etc.) missing from Jest 29 + jsdom; and `package.json` gains `jest.testEnvironmentOptions.customExportConditions` so Jest 29 resolves MSW v2's `msw/node` package-exports subpath. These overlays will be removed when RHDH targets `@backstage/cli-module-new` 0.1.7+ (Backstage 1.55.0).
- Update the RHDH 2.1.0, `main`, and `next` compatibility mappings to Backstage 1.54.6.
- Fall back to the requested RHDH version when remote metadata returns an invalid version value.

## 2.0.8 - 2026-09-15

### Fixed

- **`plugin new`:** Add the missing `jest-environment-jsdom` development dependency to generated projects so `yarn test` runs successfully.

## 2.0.6 - 2026-09-11

### Added

- **`plugin upgrade`:** Add `rhdh-cli plugin upgrade <version>` (alias `plugin versions:bump`) command ([RHIDP-16666](https://redhat.atlassian.net/browse/RHIDP-16666)). Automatically aligns all `@backstage/*` package dependencies in `package.json` (`dependencies`, `devDependencies`, `peerDependencies`) and `backstage.json` to the exact manifest versions for a target RHDH release, preserving range specifiers and non-manifest dependencies. Supports `--dry-run`, `--skip-install`, and offline `--manifest-file` options.

## 2.0.5 - 2026-09-04

### Added

- **`plugin check-versions`:** Add `rhdh-cli plugin check-versions` (alias `plugin versions:lint`) command and RHDH-to-Backstage version mapping engine ([RHIDP-16665](https://redhat.atlassian.net/browse/RHIDP-16665), [RHIDP-16667](https://redhat.atlassian.net/browse/RHIDP-16667), [#176](https://github.com/redhat-developer/rhdh-cli/pull/176)). Supports auditing `@backstage/*` dependencies in `package.json` against target RHDH release manifests using a 3-tier resolution engine (remote GitHub build-metadata, embedded static compatibility matrix fallback, and Backstage release manifests).

## 2.0.4 - 2026-08-27

### Added

- Expose the bundled Backstage CLI's intent-based `auth` and `actions` commands through `rhdh-cli` ([#167](https://github.com/redhat-developer/rhdh-cli/pull/167)). The new pass-through commands support logging in to and managing authenticated RHDH instances, as well as listing and executing actions and managing action-discovery sources. Arguments and exit codes are forwarded to the bundled CLI, while command output is rebranded as `rhdh-cli`.

## 2.0.3 - 2026-08-25

### Fixed

- **`plugin package`:** Re-throw errors after logging to ensure proper exit codes ([RHDHBUGS-3556](https://redhat.atlassian.net/browse/RHDHBUGS-3556)). The catch block in the packaging command was swallowing errors after logging them, causing the CLI to exit with code 0 even when packaging failed. This prevented wrapper scripts (like `export-dynamic.sh`) from detecting failures and caused them to attempt pushing non-existent container images. Errors are now re-thrown after logging, ensuring the CLI exits with a non-zero code and failures are properly propagated to calling scripts.

- **`plugin package`:** Work around npm pack failures with very long paths ([RHDHBUGS-3556](https://redhat.atlassian.net/browse/RHDHBUGS-3556)). The `npm pack` command can fail with an internal error ("Exit handler never called!") when run from a directory with a very long absolute path (observed with `search-backend-module-github-discussions` in community-plugins). To avoid this npm bug, the `dist-dynamic` contents are now copied to a temporary directory with a shorter path before running `npm pack`. The temporary directory is cleaned up automatically.

## 2.0.2 - 2026-08-24

### Fixed

- **`plugin package`:** Prevent publishing OCI images with empty plugin registry metadata ([RHDHBUGS-3633](https://redhat.atlassian.net/browse/RHDHBUGS-3633)). The command now fails immediately if any plugin export fails or does not produce the expected `dist-dynamic` directory. Previously, export failures were logged but did not stop the packaging process, and if all exports failed, the command would still create and publish an OCI image with an empty `io.backstage.dynamic-packages` annotation (`[]` encoded as base64), causing the RHDH installer to silently register nothing. This fail-fast behavior matches the `export-dynamic.sh` script used in CI and prevents broken images from being published.

## 2.0.1 - 2026-08-07

### Fixed

- Resolve `workspace:` / `backstage:` protocol specifiers in `peerDependencies` and pin resolved versions in `resolutions` to prevent dependency drift.
- Trap yarn install failures, surface `/tmp` install logs, and stop on error instead of continuing ([RHDHBUGS-2819](https://redhat.atlassian.net/browse/RHDHBUGS-2819)).

### Changed

- Bump Yarn Berry from 3.8.6 to 4.17.1 and Node baseline to 24 ([#159](https://github.com/redhat-developer/rhdh-cli/pull/159)).
- Update `@backstage/cli` to 0.35.4.

## 1.11.4 - 2026-07-30

### Fixed

- Propagate monorepo root yarn resolutions to dynamic plugin exports:
  read resolutions from the monorepo root `package.json` and propagate
  them to the generated `dist-dynamic/package.json`, filtering out `patch:`
  resolutions.

## 1.11.3 - 2026-07-20

### Fixed

- Added missing `backstage.features` field to generated `dist-dynamic/package.json` files in case of standard Module Federation asset generation.

## 1.11.2 - 2026-07-17

### Changed

- **Backstage dependencies** bumped to **Backstage 1.52.0**. `@backstage/cli` updated to **0.36.3**.
- **Generated type declarations** updated for the new Backstage version.
- **Backstage bump process** documented in `README.md`.

### Added

- **`backstage:bump` script** in `package.json` to automate future Backstage dependency upgrades with tilde pinning (exact for `@backstage/cli*` packages) and deduplication.

## 1.11.1 - 2026-05-20

### Fixed

- **`plugin package`:** each `dist-dynamic` plugin is staged with **`npm pack`** and **`tar`** (strip the `package/` root) instead of a recursive filesystem copy. This matches npm publish contents, omits `node_modules/.bin` entries that could point outside the image (see [RHDHBUGS-1968](https://redhat.atlassian.net/browse/RHDHBUGS-1968)), and avoids spurious "link outside of the archive" warnings when dynamic plugins are installed from OCI. **Requires `bash`, `npm` (7+ for `--pack-destination`), and `tar` on `PATH`** (for example Git Bash on Windows).

### Chore

- Dependency bumps: `follow-redirects` 1.16.0, `vm2` 3.11.5, `ws` 8.20.1, `webpack-dev-server` 5.2.4, and others.

## 1.11.0 - 2026-05-08

### Changed

- Version bump for RHDH 1.11 release.

## 1.10.8 - 2026-07-17

### Changed

- **Backstage dependencies** bumped to **Backstage 1.49.4**. `@backstage/cli` remains at **0.36.0** (exact pin).
- **Generated type declarations** updated for the new Backstage version.

### Added

- **`backstage:bump` script** in `package.json` to automate future Backstage dependency upgrades with tilde pinning (exact for `@backstage/cli*` packages) and deduplication.

## 1.10.7 - 2026-05-13

### Fixed

- **`plugin package`:** each `dist-dynamic` plugin is staged with **`npm pack`** and **`tar`** (strip the `package/` root) instead of a recursive filesystem copy. This matches npm publish contents, omits `node_modules/.bin` entries that could point outside the image (see [RHDHBUGS-1968](https://redhat.atlassian.net/browse/RHDHBUGS-1968)), and avoids spurious "link outside of the archive" warnings when dynamic plugins are installed from OCI. **Requires `bash`, `npm` (7+ for `--pack-destination`), and `tar` on `PATH`** (for example Git Bash on Windows).

## 1.10.6 - 2026-04-28

### Fixed

- **`export-dynamic-plugin` backend path:** `backstage:^` resolution now also applies in `searchEmbedded()`, which validates embedded dependency versions before `customizeForDynamicUse` runs. Previously the raw `backstage:^` string was passed directly to `semver.satisfies()`, causing the export to fail for plugins with `backstage:^` on embedded dependencies.

## 1.10.5 - 2026-04-27

### Added

- **`export-dynamic-plugin` backend path:** `backstage:^` dependency version specs are now resolved to concrete semver ranges (e.g. `^0.6.3`) using the Backstage release manifest for the version declared in `backstage.json`. This enables exports of plugins whose source repos have adopted the `backstage:^` protocol — without resolution the raw `backstage:^` string would propagate into `peerDependencies` and cause `TypeError: Invalid comparator` during embedded-package peer-dependency hoisting when the embedded package came from npm with a standard semver range.

### Fixed

- **`export-dynamic-plugin` backend path:** `workspace:^` / `workspace:~` range specifiers are now correctly prepended to the resolved version for all monorepo dependency resolution paths (previously the range prefix was applied inside one branch but missed in another, producing bare versions instead of `^x.y.z` or `~x.y.z`).

## 1.10.4 - 2026-04-09

### Changed

- **`export-dynamic-plugin` (module federation):** while running **`buildFrontend`** with **`isModuleFederationRemote`**, **`CI`** is temporarily set to **`false`** when it was **`true`**, **`1`**, or **`yes`** (case-insensitive), then restored. That avoids Rspack treating CI builds as strict in a way that breaks **`npx`** / **`CI=true`** environments ([rspack#13635](https://github.com/web-infra-dev/rspack/issues/13635)), without **`postinstall`** or patching **`node_modules`**.
- **`typescript`** is now a **runtime `dependency`** so the published CLI satisfies peers such as **`@module-federation/dts-plugin`** under strict installers (for example **Yarn PnP** with **`yarn dlx`**).

## 1.10.3 - 2026-04-08

### Changed

- Upgraded `@backstage/cli` to **0.36.0** and aligned the modular CLI setup:
  - Added **`@backstage/cli-module-build`** so build commands (including `buildFrontend` for module federation) come from the split package.
  - Added **`@backstage/cli-defaults`** so `backstage-cli package lint` and other default commands register when explicit `cli-module-*` packages are listed (Yarn discovers only direct `cli-module` dependencies).
  - Added **`@backstage/cli-module-test-jest`** so `backstage-cli package test` remains available under the new CLI architecture.
- Bumped related Backstage and bundler dependencies for compatibility (for example `@backstage/cli-common` ^0.2.0, `@backstage/cli-node` ^0.3.0, `@backstage/config` / `config-loader`, **webpack ~5.105.0**, **eslint-webpack-plugin** ^4, **fork-ts-checker-webpack-plugin** ^9, **@pmmmwh/react-refresh-webpack-plugin** ^0.6, **esbuild-loader** ^4, **bfj** ^9, **fs-extra** ^11, **react-refresh** ^0.18, **eslint-config-prettier** ^9, **@backstage/eslint-plugin** 0.2.2, **@types/fs-extra** ^11).
- **`export-dynamic-plugin` frontend path:** `buildFrontend` is now imported from `@backstage/cli-module-build/dist/lib/buildFrontend.cjs.js` instead of the removed `@backstage/cli/dist/modules/build/...` path.
- **`scripts/generate-backstage-types`** / **`scripts/backstage-types-config.json`** / **`src/generated/backstage-cli-types.d.ts`:** type extraction targets **`packages/cli-module-build`** in the Backstage monorepo (same commit as the pinned `@backstage/cli` version).

### Fixed

- **`src/lib/bundler/transforms.ts`:** `@pmmmwh/react-refresh-webpack-plugin` 0.6 no longer accepts the old `overlay.sockProtocol` shape; the plugin is invoked with default options so dev builds keep working.
- **`src/commands/package-dynamic-plugins/command.ts`:** `fs.copySync` options updated for **fs-extra** v11 / **@types/fs-extra** v11 (`recursive` is not part of `CopyOptionsSync`; directory copies remain fully recursive by default for `copySync`).

### Added

- **Yarn patch** for `@backstage/cli-module-build@0.1.0` (under `.yarn/patches/`) with **`resolutions`** in `package.json`, adding Rspack **`ignoreWarnings`** for module-federation remote builds (per upstream workaround for [rspack#13635](https://github.com/web-infra-dev/rspack/issues/13635)).

## 1.10.2 - 2026-03-18

### Changed

- **`@backstage/cli`** updated to **0.35.4** (from 0.34.x).
- **ESLint** pinned to **8.57.1** and dev tooling aligned with Backstage's lint expectations (for example `@backstage/eslint-plugin`, `@spotify/eslint-config-*`, `@typescript-eslint/*`, Jest-related ESLint plugins).
- **`jest-environment-jsdom`** added for tests that need a DOM.

### Added

- **E2E:** coverage for **rhdh-plugins scorecard** (`feat(e2e): add rhdh-plugins scorecard test`).

### Chore

- Routine dependency bumps (for example `fast-xml-parser`, `undici`, `flatted`, `tar`, `svgo`, `@backstage/integration`, `rollup`, and others via Dependabot or manual updates).

## 1.10.1 - 2026-03-13

### Changed

- Version bump and release housekeeping (**#78**).

## 1.10.0 - 2026-02-11

### Changed

- **Webpack** raised to **~5.104.1** and **`@backstage/cli-common`** to **^0.1.17** (with **`@backstage/cli`** at **0.34.1** in that timeframe).

### Chore

- **`tar`** (devDependency) updated to the 7.x line and other dependency maintenance.

## 1.9.2 - 2026-07-17

### Changed

- **Backstage dependencies** bumped to **Backstage 1.45.3**. `@backstage/cli` pinned to exact version **0.34.5**.

### Added

- **`backstage:bump` script** in `package.json` to automate future Backstage dependency upgrades with tilde pinning and deduplication.

## 1.9.1 - 2026-01-06

### Fixed

- **Webpack dependency version inconsistency** removed — `package.json` had conflicting webpack version specifications causing plugin export failures.

## 1.9.0 - 2026-01-06

### Added

- **`export-dynamic-plugin` frontend path:** new `--generate-module-federation-assets` option to generate standard module federation assets for frontend plugins.

### Fixed

- **`export-dynamic-plugin` backend path:** more robust entrypoint validation.
- **`plugin package`:** use the correct `export-dynamic-plugin` command when exporting in a monorepo.
- **CLI executable name** corrected (`rhdh-cli` binary).

## Earlier releases

Earlier tags and PRs focused on supply-chain and tooling updates (for example `node-forge`, `jws`, `undici`, `diff`, `lodash` / `lodash-es`, `fast-xml-parser`, `ajv`, `basic-ftp`, `bn.js`). Those are mostly reflected in `yarn.lock` and git history rather than this file.

### 0.0.2 (legacy entry)

- Fix missing **node-stdlib-browser** update in `scalprumConfig.ts` (very early changelog line; current releases use **1.x** versioning).

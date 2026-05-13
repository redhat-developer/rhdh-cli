# Changelog

All notable changes to `@red-hat-developer-hub/cli` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.10.7 - 2026-05-08

### Fixed

- **`plugin package`:** each `dist-dynamic` plugin is staged with **`npm pack`** and **`tar`** (strip the `package/` root) instead of a recursive filesystem copy. This matches npm publish contents, omits `node_modules/.bin` entries that could point outside the image (see [RHDHBUGS-1968](https://redhat.atlassian.net/browse/RHDHBUGS-1968)), and avoids spurious “link outside of the archive” warnings when dynamic plugins are installed from OCI. **Requires `bash`, `npm` (7+ for `--pack-destination`), and `tar` on `PATH`** (for example Git Bash on Windows).

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
- **ESLint** pinned to **8.57.1** and dev tooling aligned with Backstage’s lint expectations (for example `@backstage/eslint-plugin`, `@spotify/eslint-config-*`, `@typescript-eslint/*`, Jest-related ESLint plugins).
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

## Earlier releases

Earlier tags and PRs focused on supply-chain and tooling updates (for example `node-forge`, `jws`, `undici`, `diff`, `lodash` / `lodash-es`, `fast-xml-parser`, `ajv`, `basic-ftp`, `bn.js`). Those are mostly reflected in `yarn.lock` and git history rather than this file.

### 0.0.2 (legacy entry)

- Fix missing **node-stdlib-browser** update in `scalprumConfig.ts` (very early changelog line; current releases use **1.x** versioning).

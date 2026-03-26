# Changelog

<!-- markdownlint-disable MD013 MD024 -->

All notable changes to `@red-hat-developer-hub/cli` are documented here. This project no longer uses Changesets; releases are versioned in `package.json` and described here (and in conventional commit messages / PR titles).

## 1.10.3

### Added

- **`prepare` lifecycle**: when `dist/` is missing (for example after cloning or installing from a git ref), runs `yarn build` so colleagues can try a PR via `npx` / `yarn dlx` without a separate build step. Skipped when `dist/` already exists (for example the published npm tarball).
- **Plugin export — workspace `resolutions`**: `plugin export` merges `resolutions` from the `package.json` next to the same `yarn.lock` used for the export (plugin package or monorepo root). Non-portable values (`workspace:`, `portal:`, `link:` at value start, and non-string shapes) are omitted with a warning. Merge order: built-in AWS workarounds, then packed manifest, then workspace, then backend `additionalResolutions` (embedded `file:` still wins on conflicts).
- **Documentation**: maintainer guide for the export pipeline under [`doc/plugin-export/`](doc/plugin-export/README.md).

### Changed

- **Frontend dynamic plugin export**: Yarn project setup and install behavior aligned with backend export (lockfile, **generated minimal** Berry **`.yarnrc.yml`**, logging where applicable).
- **Dependencies**: `fast-xml-parser` 5.5.7 (#87).

### Fixed

- **Yarn Berry `dist-dynamic/.yarnrc.yml`**: no longer a copy of the monorepo file; the exporter writes a **minimal generated** config (**`httpTimeout`** + **`nodeLinker: node-modules`**) so **`yarn install`** does not fail when the parent repo lists Berry **plugins** (e.g. under **`.yarn/plugins/`**) that are not present in the export tree.
- **Yarn lockfile** for frontend plugin export installs (`yarn.lock` consistency).

## 1.10.2

### Changed

- **@backstage/cli** updated to **0.35.4** (#86).

### Added

- **jest-environment-jsdom** (dev) for the test toolchain.

## 1.10.1

### Changed — 1.10.1

- **Node.js**: CI and tooling moved to **Node 22** (#54).
- **Dependencies**: broad updates including **ESLint 9**, **webpack** / **@backstage/cli-common**, **axios**, **lodash** / **lodash-es**, **tar** (dev), **fast-xml-parser**, **ajv**, **undici**, **diff**, **jsonpath**, **node-forge**, **jws**, and others (Dependabot and manual bumps through #57–#62, #65–#66, #68–#69, #81, #83).

### Fixed

- **`plugin export`**: clearer handling when **`yarn install`** fails under `dist-dynamic` (log path, fail fast) — RHDHBUGS-2819 (#70, #73; see also #77).

## 1.10.0

### Changed

- **Version** aligned with RHDH **1.10** line.

### Fixed

- **E2E tests** for community plugin build (#52).
- **Webpack** dependency alignment across the tree (#39).

## 1.9.1

### Fixed — 1.9.1

- **Webpack** / **webpack-dev-server** version inconsistency in published metadata (#35 follow-up).

## 1.9.0

### Added

- **`--generate-module-federation-assets`** (and inverse) for **frontend** `plugin export`, emitting standard Module Federation assets alongside Scalprum (#31).
- **`generate-types`** script and **Backstage CLI** dependency bump for the build.

### Changed

- **Version** aligned with RHDH **1.9** line.

### Fixed

- **CLI binary** name / packaging (`rhdh-cli`) (#26).

## 1.8.0 and earlier

Releases **1.8.x** and below used the same tagging process (`tagRelease.sh` / automated bump PRs). Notable older changes include:

- **`plugin package`**: correct export command in user-facing text (#22).
- **README**: versioning notes; move away from Changesets toward conventional commits (#20).
- **E2E**: optional archive download instead of git clone for community plugin build tests.

## Historic (0.x)

### 0.0.2

- Fix missing **node-stdlib-browser** update in `scalprumConfig.ts` (66e629b; Changesets-era entry).

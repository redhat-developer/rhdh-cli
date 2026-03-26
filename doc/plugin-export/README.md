# `plugin export` — documentation index

This folder describes how **`rhdh-cli plugin export`** repackages a Backstage plugin into **`./dist-dynamic`** for use as a dynamic plugin. It is aimed at maintainers and contributors who need to understand or explain the pipeline.

## Quick links

| Document                                     | Contents                                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [command-flow.md](./command-flow.md)         | Shared steps after backend vs frontend dispatch: config schema, `supported-versions`, `--dev`            |
| [backend-export.md](./backend-export.md)     | Backend / backend-module export phases (`backend.ts`)                                                    |
| [frontend-export.md](./frontend-export.md)   | Frontend / frontend-module export phases (`frontend.ts`)                                                 |
| [shared-packaging.md](./shared-packaging.md) | `productionPack`, `customizeForDynamicUse`, workspace `resolutions` inheritance, `initializeYarnProject` |

## Command and entrypoints

- **CLI registration**: [`src/commands/index.ts`](../../src/commands/index.ts) (`plugin export` subcommand and flags).
- **Orchestrator**: [`src/commands/export-dynamic-plugin/command.ts`](../../src/commands/export-dynamic-plugin/command.ts) — reads `backstage.role`, calls `backend()` or `frontend()`, then writes config schema, checks `supported-versions`, applies `--dev`.

**Example** (from the plugin package directory):

```bash
npx @red-hat-developer-hub/cli plugin export
```

## Prerequisites

- The **current working directory** (or Backstage CLI target) must be a package whose **`package.json`** defines **`backstage.role`**.
- **Supported roles** (see `command.ts`): `backend-plugin`, `backend-plugin-module`, `frontend-plugin`, `frontend-plugin-module`. Other roles are rejected.

## Output

- Primary artifact: **`dist-dynamic/`** under the plugin package, containing a derived **`package.json`**, optional **`yarn.lock`** / **`.yarnrc.yml`**, **`packageManager`**, and built assets (layout differs by role; see backend vs frontend docs).
- **Config schema** JSON is written under paths that depend on role (see [command-flow.md](./command-flow.md)).

## CLI options matrix

Flags are registered on `plugin export` for all roles; **only some are honored** depending on implementation.

| Option                                                                           | Backend | Frontend | Notes                                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | :-----: | :------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--embed-package`                                                                |   Yes   |    —     |                                                                                                                                                                                             |
| `--shared-package`                                                               |   Yes   |    —     | Moves matching deps to `peerDependencies` (plus default `@backstage/*`).                                                                                                                    |
| `--allow-native-package`                                                         |   Yes   |    —     |                                                                                                                                                                                             |
| `--suppress-native-package`                                                      |   Yes   |    —     |                                                                                                                                                                                             |
| `--ignore-version-check`                                                         |   Yes   |    —     | Relaxes semver checks when embedding / hoisting peers.                                                                                                                                      |
| `--no-install` / `--install`                                                     |   Yes   |   Yes    | Commander exposes `--no-install`. Backend help says “backend only” but **frontend** [`handlePackageInstall`](../../src/commands/export-dynamic-plugin/frontend.ts) also respects it.        |
| `--no-build` / `--build`                                                         |   Yes   |    —     |                                                                                                                                                                                             |
| `--clean`                                                                        |   Yes   |   Yes    |                                                                                                                                                                                             |
| `--dev`                                                                          |   Yes   |   Yes    | Symlink `src` for **node** platform; frontend gets symlink/copy without `src` link. See [command-flow.md](./command-flow.md).                                                               |
| `--dynamic-plugins-root`                                                         |   Yes   |   Yes    | Used with `--dev` when copying instead of symlinking.                                                                                                                                       |
| `--scalprum-config`                                                              |    —    |   Yes    |                                                                                                                                                                                             |
| `--track-dynamic-manifest-and-lock-file`                                         |   Yes   |   Yes    | Whitelists `package.json`, `yarn.lock`, and `.yarnrc.yml` in `dist-dynamic/.gitignore`. Name refers to manifest + lockfile; **`.yarnrc.yml` is included** for Yarn Berry standalone config. |
| `--generate-scalprum-assets` / `--no-generate-scalprum-assets`                   |    —    |   Yes    |                                                                                                                                                                                             |
| `--generate-module-federation-assets` / `--no-generate-module-federation-assets` |    —    |   Yes    | At least one of Scalprum or MF must stay enabled.                                                                                                                                           |

For exact strings, see [`src/commands/index.ts`](../../src/commands/index.ts).

## Source layout (reference)

```text
src/commands/export-dynamic-plugin/
  command.ts      # role dispatch + post-export steps
  backend.ts      # backend export implementation
  frontend.ts     # frontend export implementation
  common-utils.ts # customizeForDynamicUse, initializeYarnProject
  dev.ts          # --dev symlink / install into dynamic plugins root
  backend-utils.ts
  types.ts
```

## Related commands

- **`plugin package`** — builds a container image / registry workflow from exported plugins ([`src/commands/index.ts`](../../src/commands/index.ts)); not covered here.

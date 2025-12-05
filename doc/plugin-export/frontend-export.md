# Frontend dynamic plugin export

Walkthrough of [`frontend.ts`](../../src/commands/export-dynamic-plugin/frontend.ts): **`frontend-plugin`** and **`frontend-plugin-module`** packages. Output lives under **`dist-dynamic/`** and may include **Scalprum** and/or **Module Federation** assets under the plugin tree.

← [Back to index](./README.md) · Shared packaging: [shared-packaging.md](./shared-packaging.md)

## 1. Asset modes (CLI)

- At least one of **`--generate-scalprum-assets`** or **`--generate-module-federation-assets`** must remain enabled (defaults: both **true** in [`index.ts`](../../src/commands/index.ts)); otherwise the command throws.
- **`--scalprum-config <file>`** overrides inline **`scalprum`** config in **`package.json`** for Scalprum generation.

## 2. Optional Module Federation assets

When **`--generate-module-federation-assets`** is on:

- With **`--clean`**, remove the plugin’s **`dist/`** first.
- Call Backstage **`buildFrontend`** with **`isModuleFederationRemote: true`**, writing the standard MF remote bundle into **`paths.targetDir/dist/`**.

## 3. `dist-dynamic` directory

- Path: **`paths.targetDir/dist-dynamic`**.
- **`--clean`**: remove **`dist-dynamic`** first.
- Write **`.gitignore`** (ignore all; optional whitelist with **`--track-dynamic-manifest-and-lock-file`**: **`package.json`**, **`yarn.lock`**, and **`.yarnrc.yml`** — the flag name only says manifest and lockfile, but **`.yarnrc.yml` is included** so the minimal Berry rc can be committed with them; same behavior as backend).
- **`productionPack`** from **`paths.targetDir`** into **`dist-dynamic`** ([shared-packaging.md](./shared-packaging.md)).

## 4. Customize main `package.json`

- **`customizeForDynamicUse`** with **no embedded packages** and **`isYarnV1: false`**, after loading [lockfile-adjacent workspace **`resolutions`**](./shared-packaging.md#workspace-resolutions-inheritance):
  - **`name`** → **`<original>-dynamic`**
  - **`scripts`** cleared
  - **`files`**: ensure **`dist-scalprum`** is listed when Scalprum generation is enabled and not already present
- Workspace **`workspace:`** dependencies are resolved to concrete versions using monorepo **`getPackages`**.

## 5. Optional Scalprum assets

When **`--generate-scalprum-assets`** is on:

- Remove previous **`dist-dynamic/dist-scalprum`**.
- **`buildScalprumPlugin`**: emits Scalprum bundle/metadata into **`dist-dynamic/dist-scalprum`**, using resolved config (file, **`package.json`**, or defaults documenting **`exposedModules`**, etc.).

## 6. Yarn project and install (`handlePackageInstall`)

- **`initializeYarnProject`**: lockfile, **generated minimal** Berry **`.yarnrc.yml`**, **`packageManager`** ([shared-packaging.md](./shared-packaging.md)).
- **`--no-install`**: skip **`yarn install`** and warn; otherwise run install in **`dist-dynamic`** with Yarn 1 vs Berry flags, then remove **`.yarn`** and the local **`yarn-install.log`** under **`dist-dynamic`**.

## 7. Return value

Returns the **`dist-dynamic`** path for **`command.ts`** (config schema paths depend on which of **`dist/`** / **`dist-scalprum`** exist).

← [Back to index](./README.md)

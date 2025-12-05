# Backend dynamic plugin export

Walkthrough of [`backend.ts`](../../src/commands/export-dynamic-plugin/backend.ts): **`backend-plugin`** and **`backend-plugin-module`** packages. The result is a self-contained tree under **`dist-dynamic/`** suitable for loading as a Node dynamic plugin.

← [Back to index](./README.md) · Shared packaging: [shared-packaging.md](./shared-packaging.md)

## 1. Inputs and guards

- Parse the plugin **`package.json`**; reject if **`bundled: true`** (dynamic backend plugins must not be bundled in this sense).
- Resolve CLI lists: **`--embed-package`**, **`--shared-package`**, **`--allow-native-package`**, **`--suppress-native-package`**, **`--ignore-version-check`**.
- Load monorepo layout with **`@manypkg/get-packages`** from **`paths.targetDir`**.
- **`searchEmbedded`** ([`backend.ts`](../../src/commands/export-dynamic-plugin/backend.ts) + [`backend-utils`](../../src/commands/export-dynamic-plugin/backend-utils.ts)) resolves which packages to embed from the dependency graph and optional **`--embed-package`** names; may auto-include related **`-common`** / **`-node`** packages depending on role.

## 2. Shared dependency rules

- **`sharedPackagesRules`**: by default, **`@backstage/*`** dependencies are treated as **shared** (moved to **`peerDependencies`** during [`customizeForDynamicUse`](./shared-packaging.md)).
- **`--shared-package`** adds patterns (string or `/regex/`); entries prefixed with **`!`** go to **`exclude`** (do not force to peer).
- **Embedded package names** are always excluded from the “move to peer” rule so they stay private/embedded as intended.

## 3. Prepare `dist-dynamic`

- Optional **`--clean`**: remove **`dist-dynamic`** entirely.
- Recreate directory and write **`.gitignore`** (ignore all by default).
- With **`--track-dynamic-manifest-and-lock-file`**, whitelist **`package.json`**, **`yarn.lock`**, and **`.yarnrc.yml`** in **`dist-dynamic/.gitignore`** so they can be committed (productization). The flag name refers to manifest and lockfile; **`.yarnrc.yml` is included** for the generated minimal Yarn Berry config.

## 4. Suppress native (`--suppress-native-package`)

For each suppressed name, materialize a stub under **`embedded/<name>/`** (minimal **`package.json`** + **`index.js`** that throws) so resolutions can point at a non-native placeholder.

## 5. Embedded packages loop

For each resolved embedded package:

- Optional **`yarn build`** in the embedded package dir when **`--build`** (default install path uses `opts.build`).
- **`productionPack`** into **`dist-dynamic/embedded/<normalized-name>/`**, or **recursive copy** if already packed.
- Remove **`node_modules`** under the embedded copy if present.
- **`customizeForDynamicUse`** on the embedded **`package.json`** (private, version suffix `+embedded`, shared/peer rules, workspace resolution, Yarn v1 **`file:`** for embedded deps when applicable), including [lockfile-adjacent workspace **`resolutions`**](./shared-packaging.md#workspace-resolutions-inheritance) merged before backend-only **`additionalResolutions`**.
- Collect **peer dependencies** from embedded packages for later hoisting onto the main package.

## 6. Main package

- Optional **`yarn build`** at **`paths.targetDir`** when **`--build`**.
- **`productionPack`** with **`packageDir: ''`** so file resolution uses the **Backstage CLI target directory** (plugin root) as the pack root, output into **`dist-dynamic`**.
- Remove nested **`dist-dynamic/dist-dynamic`** if **`files`** accidentally included it.
- **`customizeForDynamicUse`** on the main **`package.json`** (same [workspace \*\*`resolutions` inheritance](./shared-packaging.md#workspace-resolutions-inheritance); embedded **`file:`** resolutions still win on conflicts):
  - Rename to **`<original-name>-dynamic`**
  - **`bundleDependencies: true`**
  - Clear **`scripts`**
  - **`resolutions`** / **`yarn`** resolutions wiring **`file:./embedded/...`** for embedded packages (and suppressed native stubs)
  - Hoist collected embedded **peer** requirements onto the main **`peerDependencies`** when non-empty

Details of manifest rewriting: [shared-packaging.md](./shared-packaging.md).

## 7. Yarn project metadata (`initializeYarnProject`)

See [shared-packaging.md](./shared-packaging.md). Summaries: copy **`yarn.lock`** if missing, **generate** a minimal Berry **`.yarnrc.yml`** in **`dist-dynamic`** (**`httpTimeout`** + **`nodeLinker: node-modules`**; see shared doc), set **`packageManager`**.

## 8. `yarn install`

- Skipped when **`--no-install`**; user is warned the lockfile may be stale until they install manually.
- Otherwise run **`yarn install`** in **`dist-dynamic`** with Yarn **1.x** vs **Berry**-appropriate flags; log to a temp file on backend, then remove **`.yarn`** under **`dist-dynamic`** after success.

## 9. Post-install validation (install path only)

1. **Shared vs private**: scan **`yarn.lock`** so no **shared** package (per rules) appears as a private dependency; on failure, suggest **`--shared-package !...`** or **`--embed-package`** with a derived hint list.
2. **Native modules**: **`gatherNativeModules`**; fail unless listed in **`--allow-native-package`**.
3. **Entry points**: **`validatePluginEntryPoints`** ([`backend-utils.ts`](../../src/commands/export-dynamic-plugin/backend-utils.ts)) — ensures expected backend plugin entry surface.

On success, the yarn install log is removed (see **`logFile`** / **`fs.remove`** usage at the end of the install block in **`backend.ts`**).

## 10. Return value

Returns the absolute **`dist-dynamic`** path for **`command.ts`** to append config schema and dev steps.

← [Back to index](./README.md)

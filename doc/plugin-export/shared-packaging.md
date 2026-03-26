# Shared packaging helpers

Utilities used by both backend and frontend export paths.

← [Back to index](./README.md)

## `productionPack`

**Source:** [`src/lib/packager/productionPack.ts`](../../src/lib/packager/productionPack.ts)

- Reads the source **`package.json`**, applies publish/manifest normalization (e.g. hoists relevant **`publishConfig`** fields, prepares **`exports`** from **`dist/`** when present via **`readEntryPoints`**).
- When **`targetDir`** is set, uses **`npm-packlist`** to enumerate files that would ship in an npm tarball (respects **`files`**, **`.npmignore`**, etc.) and **copies** them into **`targetDir`**, writing the **mutated `package.json`** into that tree.
- **Backend main package** calls it with **`packageDir`** as the empty string so paths resolve against the **Backstage CLI target directory** (the plugin root). **Embedded** copies use the embedded package’s directory. **Frontend** passes **`paths.targetDir`**.

This is the primary mechanism that materializes **`dist-dynamic`** file layout before manifest customization runs.

## `customizeForDynamicUse`

**Source:** [`src/commands/export-dynamic-plugin/common-utils.ts`](../../src/commands/export-dynamic-plugin/common-utils.ts)

Higher-order function returning an async closure: **`(dynamicPkgPath) => Promise<void>`**.

Applied to **`dist-dynamic/package.json`** (and embedded **`package.json`** files on the backend). Notable behaviors:

- Applies **`overriding`** fields from the caller (name, scripts, `bundleDependencies`, etc.).
- Strips **`dist-dynamic/`** from **`files`** entries.
- Resolves **`workspace:`** dependency specs to concrete versions using **`embedded`** list and **`@manypkg/get-packages`** monorepo data; throws if a workspace dep cannot be resolved.
- **Shared packages** (rules from backend; frontend uses default movement only where configured): matching dependencies move to **`peerDependencies`**.
- **Yarn 1.x** (`isYarnV1`): embedded deps can be rewritten to **`file:./embedded/...`**.
- Clears **`devDependencies`** so the dynamic package is production-oriented.
- Merges known **`overrides`** / **`resolutions`** workarounds (e.g. AWS SDK utf8 packages).
- Merges optional **`workspaceResolutions`** (see [Workspace `resolutions` inheritance](#workspace-resolutions-inheritance) below).
- Optional **`after`** hook for callers (backend uses it to hoist embedded peers).

## Workspace `resolutions` inheritance

**Source:** [`common-utils.ts`](../../src/commands/export-dynamic-plugin/common-utils.ts) — **`loadResolutionsFromYarnLockWorkspace`**, used from backend and frontend export before **`customizeForDynamicUse`**.

When the derived **`dist-dynamic/package.json`** is built, **`yarn install`** there uses a **`yarn.lock`** copied from the same place the exporter already chooses: **`yarn.lock`** next to the plugin package if present, otherwise the monorepo root. **`loadResolutionsFromYarnLockWorkspace`** reads **`resolutions`** from the **`package.json`** in that same directory (the “lockfile-adjacent” manifest). If there is no lockfile or no valid plain-object **`resolutions`** field, nothing is added.

**Merge precedence** for the final **`resolutions`** object inside **`customizeForDynamicUse`**:

1. Built-in AWS-related pins (utf8 workaround).
2. **`resolutions`** from the **packed** plugin manifest (after other manifest transforms).
3. **`workspaceResolutions`** loaded as above (monorepo / root policy overrides plugin pins when keys clash).
4. **`additionalResolutions`** from the caller — **always wins** on duplicate keys (backend: embedded **`file:./embedded/...`** and suppress-native stubs must stay authoritative).

**Sanitization:** Entries whose values use monorepo-only Yarn protocols at the start of the string (**`workspace:`**, **`portal:`**, **`link:`**, case-insensitive, ignoring leading whitespace) are **not** copied into the derived package; they would not resolve in standalone **`dist-dynamic`**. Non-string values (nested objects, arrays) are also omitted because only a **shallow** key merge is supported. When anything is omitted, the CLI logs a **single warning** listing the dropped keys.

After sanitization, **all** remaining inherited entries are merged into the derived manifest. That includes pins that only affect **transitive** dependencies (for example workspace-wide CVE overrides), even when the exported package does not list that package name directly. The trade-off is that unrelated root pins (e.g. **`react`** on a backend-only plugin) may still appear in **`dist-dynamic/package.json`**; they are inert for **`yarn install`** unless something in the install graph matches them.

**Limitations (not changed in this feature):**

- **Nested or non-scalar `resolutions` values** (as allowed in some Yarn versions): exotic structures are not deep-merged; only portable flat string entries are inherited as-is.
- Root **`overrides`** in **`package.json`** (npm / parity with other tools) are **not** copied; installs still rely on **`resolutions`** plus the lockfile. If you depend on root-only **`overrides`**, duplicate that policy in **`resolutions`** or extend the export separately.

## `initializeYarnProject`

**Source:** same [`common-utils.ts`](../../src/commands/export-dynamic-plugin/common-utils.ts).

Runs before **`yarn install`** in **`dist-dynamic`** (and still runs when install is skipped, so metadata is present):

1. **`yarn.lock`**: if missing, copy from the plugin directory or monorepo root (same search order as the previous lock-only helper).
2. **`.yarnrc.yml`** (Yarn Berry semantics): the file under **`dist-dynamic`** is **generated**, not copied from the monorepo. For Yarn **> 1**, the exporter always writes **`httpTimeout`** (long timeout for large lockfiles) and **`nodeLinker: node-modules`** so **`yarn install`** runs as a standalone project and does **not** load monorepo-only Berry **plugins** (for example paths under **`.yarn/plugins/`** that are absent in **`dist-dynamic`**). If the YAML is missing or invalid, it is replaced with that same minimal shape. **Yarn 1**: no synthetic **`.yarnrc.yml`**; **`nodeLinker`** enforcement is a no-op.
3. **`packageManager`**: set on **`package.json`** to **`yarn@<version>`**, preferring semver parsed from Berry **`yarnPath`** when that can be read from a **pre-existing** **`dist-dynamic/.yarnrc.yml`** (packed artifact edge case) or from the workspace **`.yarnrc.yml`** next to the plugin or repo root (**read-only**; the file is not copied into **`dist-dynamic`**), else **`yarn --version`**.

This keeps **`dist-dynamic`** recognizable as a standalone Yarn project (lockfile + config + Corepack **`packageManager`**) for installs and tooling such as SBOM generation.

**Versioning `dist-dynamic` Yarn metadata:** pass **`--track-dynamic-manifest-and-lock-file`** to **`plugin export`**. The CLI writes **`dist-dynamic/.gitignore`** as ignore-all with negated entries for **`package.json`**, **`yarn.lock`**, and **`.yarnrc.yml`** so those files can be committed. The option name highlights the manifest and lockfile; **`.yarnrc.yml` is part of the same whitelist** (minimal generated Berry settings, not the monorepo’s full rc).

← [Back to index](./README.md)

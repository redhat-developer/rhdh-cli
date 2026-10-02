# RHDH CLI - Plugin Development Guide

Complete guide for using `rhdh-cli` to scaffold, develop, audit, upgrade, and package dynamic plugins for Red Hat Developer Hub (RHDH).

---

## Table of Contents

- [Overview & Architecture](#overview--architecture)
- [Command Summary](#command-summary)
- [Scaffolding a New Plugin (`plugin new`)](#scaffolding-a-new-plugin-plugin-new)
  - [Syntax & Options](#syntax--options)
  - [Supported Plugin Types](#supported-plugin-types)
  - [Upstream Template Reuse](#upstream-template-reuse)
  - [Standalone Development Harness](#standalone-development-harness)
- [Auditing Plugin Dependencies (`plugin check-versions`)](#auditing-plugin-dependencies-plugin-check-versions)
  - [Syntax & Options](#syntax--options-1)
  - [Version Mapping & 3-Tier Resolution](#version-mapping--3-tier-resolution)
  - [Audit Statuses](#audit-statuses)
  - [CI Pipeline Integration](#ci-pipeline-integration)
- [Upgrading Plugin Dependencies (`plugin upgrade`)](#upgrading-plugin-dependencies-plugin-upgrade)
  - [Syntax & Options](#syntax--options-2)
  - [Dry-Run Preview](#dry-run-preview)
  - [Lockfile Synchronization](#lockfile-synchronization)
  - [Range Preservation & Non-Backstage Packages](#range-preservation--non-backstage-packages)
- [Local Containerized Runtime Development (`plugin dev`)](#local-containerized-runtime-development-plugin-dev)
  - [Prerequisites](#prerequisites)
  - [Lifecycle Subcommands](#lifecycle-subcommands)
  - [Automated Configuration with `--configure`](#automated-configuration-with---configure)
  - [Continuous Development with `--watch`](#continuous-development-with---watch)
  - [Inspecting Runtime & Logs](#inspecting-runtime--logs)
- [Exporting & Packaging Plugins](#exporting--packaging-plugins)
  - [Dynamic Export (`plugin export`)](#dynamic-export-plugin-export)
  - [OCI Container Packaging (`plugin package`)](#oci-container-packaging-plugin-package)
- [Air-Gapped & Offline Operations](#air-gapped--offline-operations)

---

## Overview & Architecture

Developing dynamic plugins for Red Hat Developer Hub previously required maintaining a full Backstage monorepo host application (`packages/app` and `packages/backend`), introducing significant boilerplate and upgrade friction. Furthermore, RHDH releases incorporate curated Backstage versions and skip intermediate upstream releases, making manual dependency resolution error-prone.

The `rhdh-cli` plugin developer on-ramp provides:

1. **Zero Host Overhead:** Scaffold, develop, build, and test standalone dynamic plugins as self-contained Yarn Berry workspaces without hosting a full Backstage app.
2. **5-Minute "Time to Hello World":** Scaffold a working plugin and run it against a local containerized RHDH instance in under five minutes.
3. **Automated Dependency Alignment:** Automatically align `@backstage/*` dependencies against the official Backstage release manifest for your target RHDH release.
4. **Live Containerized Feedback:** Test plugins inside a real RHDH Local Compose environment with automated staging, HTTP readiness polling, and watch-mode reload.

---

## Command Summary

| Command                          | Alias                  | Description                                                                                               |
| -------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `rhdh-cli plugin new`            | —                      | Scaffold a standalone, version-pinned dynamic plugin project                                              |
| `rhdh-cli plugin check-versions` | `plugin versions:lint` | Audit plugin dependencies against target RHDH Backstage release manifests                                 |
| `rhdh-cli plugin upgrade`        | `plugin versions:bump` | Upgrade `@backstage/*` dependencies and sync lockfile to target RHDH release                              |
| `rhdh-cli plugin dev`            | —                      | Drive a local containerized RHDH Compose runtime (`start`, `update`, `restart`, `stop`, `logs`, `status`) |
| `rhdh-cli plugin export`         | —                      | Build and export a plugin package into `./dist-dynamic/` for dynamic loading                              |
| `rhdh-cli plugin package`        | —                      | Package exported dynamic plugins into container images (OCI) for deployment                               |

---

## Scaffolding a New Plugin (`plugin new`)

Creates a standalone, version-pinned dynamic plugin project that is ready to develop, test, and export.

### Syntax & Options

```bash
rhdh-cli plugin new <name> [options]
```

**Arguments:**

- `<name>`: The plugin name. Used to derive the default output directory and package name.

**Options:**

- `--type <type>`: Plugin type: `frontend`, `backend`, or `catalog-processor-module`.
- `--template <name>`: Upstream template name from `@backstage/cli-module-new` (alternative to `--type`).
- `--rhdh-version <version>`: Target RHDH release version for dependency pinning (e.g. `2.1.0`, `2.1`, `2.0.0`). Defaults to the latest supported GA release (`2.1.0`).
- `--output <directory>`: Target directory for the scaffolded project (defaults to `<name>`).
- `--plugin-package <name>`: Override the generated `package.json` package name (defaults to `@internal/backstage-plugin-<name>`).
- `--module-id <id>`: Override the module identifier for module-type templates (defaults to `<name>`).

**Example:**

```bash
# Scaffold a frontend plugin for RHDH 2.1
rhdh-cli plugin new my-custom-plugin --type frontend --rhdh-version 2.1.0
```

### Supported Plugin Types

| Type                       | Description                               | Included Features                                                                                 |
| -------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `frontend`                 | New Frontend System (NFS) frontend plugin | Routed page (`PageBlueprint`), `EntityCard` extension, i18n support, and MSW v2-backed unit tests |
| `backend`                  | New Backend System (NBS) backend plugin   | Default dynamic export in `src/index.ts`, standalone backend router, and test utilities           |
| `catalog-processor-module` | Backend module extending the catalog      | Custom catalog processor module registration extending `@backstage/plugin-catalog-backend`        |

### Upstream Template Reuse

Rather than maintaining divergent templates, `rhdh-cli plugin new` renders portable templates directly from the release-matched `@backstage/cli-module-new` package. It applies an RHDH standalone adapter that configures:

- Standalone Yarn Berry (`yarn@4.x`) configuration with `node-modules` linker.
- Pinned `@backstage/*` dependencies strictly matching the target RHDH release manifest.
- Versioned `backstage.json` recording the underlying Backstage release.
- Standalone TypeScript configuration and build scripts.

Generated projects do **not** depend on `@red-hat-developer-hub/cli` as a runtime dependency. The generated README directs authors to use `npx @red-hat-developer-hub/cli` for export and packaging.

### Standalone Development Harness

Frontend and backend plugins include an isolated `dev/` harness:

```bash
cd my-custom-plugin
yarn install
yarn start
```

This launches a lightweight local dev server to develop and iterate on UI components or backend endpoints in isolation without running a full container stack.

---

## Auditing Plugin Dependencies (`plugin check-versions`)

Audits the `@backstage/*` dependencies declared in `package.json` against the official Backstage release manifest for a specified RHDH release. This catches dependency drift before it causes build or runtime failures.

### Syntax & Options

```bash
rhdh-cli plugin check-versions [options]
rhdh-cli plugin versions:lint [options]       # alias
```

**Options:**

- `--rhdh-version <version>`: Target RHDH version to validate against (e.g. `2.1.0`, `2.1`, `2.0.0`, `1.10`, `latest`). Defaults to latest supported GA release.
- `--manifest-file <path>`: Path to a local Backstage release manifest JSON file for air-gapped/offline verification.
- `--json`: Output structured JSON suitable for CI/CD automation and scripts.

### Version Mapping & 3-Tier Resolution

RHDH versions (e.g. `2.1.0`) differ from Backstage versions (e.g. `1.54.6`). `rhdh-cli` resolves the target version using a 3-tier strategy:

1. **Remote Metadata (Tier 1):** Fetches `build-metadata.json` from the target RHDH release branch in the `redhat-developer/rhdh` repository.
2. **Static Compatibility Matrix (Tier 2):** Fallback table embedded in the CLI for offline use or when remote lookups are skipped (`RHDH_OFFLINE=true`):
   - `2.1.0` / `2.1` $\rightarrow$ Backstage `1.54.6`
   - `2.0.4` / `2.0.0` / `2.0` $\rightarrow$ Backstage `1.52.0`
   - `1.10.0` / `1.10` $\rightarrow$ Backstage `1.49.4`
   - `1.9.0` / `1.9` $\rightarrow$ Backstage `1.45.3`
   - `1.8.0` / `1.8` $\rightarrow$ Backstage `1.42.5`
3. **Manifest Resolution (Tier 3):** Fetches the concrete package manifest from `versions.backstage.io` (or a local `--manifest-file`). To target a Backstage version directly, prefix it with `backstage:`, e.g. `--rhdh-version backstage:1.54.0`.

### Audit Statuses

| Status         | Symbol | Meaning                                                             |
| -------------- | ------ | ------------------------------------------------------------------- |
| `match`        | `✓`    | Declared dependency matches the exact manifest version              |
| `mismatch`     | `✗`    | Declared dependency version differs from the manifest version       |
| `unmanifested` | `⚠`   | `@backstage/*` package is not part of the official release manifest |
| `unverifiable` | `⚠`   | Package uses `backstage:^` without a readable `backstage.json`      |

**Exit Codes:**

- `0`: All `@backstage/*` dependencies match the target release manifest.
- `1`: Version mismatches or unmanifested packages were detected.

### CI Pipeline Integration

Use `plugin check-versions` in your CI workflow to ensure pull requests do not introduce drifted dependencies:

```yaml
# .github/workflows/ci.yaml
- name: Audit Backstage Dependencies
  run: |
    npx @red-hat-developer-hub/cli plugin check-versions --rhdh-version 2.1 --json
```

If mismatches are found, the command exits with code 1, reports mismatched packages, and provides the remediation command:

```
Remediation: Run rhdh-cli plugin upgrade 2.1.0 to align dependencies with RHDH v2.1.0.
```

---

## Upgrading Plugin Dependencies (`plugin upgrade`)

Aligns all `@backstage/*` dependencies in `package.json` (`dependencies`, `devDependencies`, `peerDependencies`) and `backstage.json` to the target RHDH release manifest versions.

### Syntax & Options

```bash
rhdh-cli plugin upgrade [rhdhVersion] [options]
rhdh-cli plugin versions:bump [rhdhVersion] [options]   # alias
```

**Arguments:**

- `[rhdhVersion]`: Target RHDH version (e.g. `2.1.0`, `2.1`, `2.0.0`, `latest`). Defaults to latest GA release when omitted.

**Options:**

- `--dry-run`: Displays planned package modifications in a table without modifying files on disk.
- `--skip-install`: Updates `package.json` and `backstage.json` but skips running the package manager install.
- `--manifest-file <path>`: Path to a local Backstage release manifest for offline/air-gapped usage.
- `--json`: Output upgrade results as structured JSON.

### Dry-Run Preview

To inspect planned version changes without altering any files:

```bash
rhdh-cli plugin upgrade 2.1.0 --dry-run
```

Output:

```
Resolving Backstage version for RHDH v2.1.0...
Target Backstage release: 1.54.9 [remote]

Planned Dependency Upgrades:

Package                     Section       Current  Target   Status
-------------------------------------------------------------------
@backstage/core-plugin-api  dependencies  ^1.12.7  ^1.12.9  UPGRADE
@backstage/core-components  dependencies  ^0.18.11 ^0.18.13 UPGRADE

Dry run completed. 2 dependencies would be updated in package.json.
```

### Lockfile Synchronization

By default, after updating `package.json` and `backstage.json`, `plugin upgrade` automatically detects whether your project uses Yarn (`yarn.lock`) or npm (`package-lock.json`) and runs `yarn install` or `npm install` to synchronize lockfiles.

Use `--skip-install` if you want to inspect file changes or run your install separately with custom flags:

```bash
rhdh-cli plugin upgrade 2.1.0 --skip-install
```

### Range Preservation & Non-Backstage Packages

- **Preserves Specifier Style:** If your dependency was declared as `^1.12.0`, `~1.12.0`, or `1.12.0`, the prefix is preserved when bumping to the target version (e.g. `^1.12.9`).
- **Preserves Third-Party Packages:** Dependencies outside the `@backstage/*` namespace (e.g. `react`, `lodash`, `express`) are left untouched.
- **Updates `backstage.json`:** Synchronizes the `version` field in `backstage.json` when present.

---

## Local Containerized Runtime Development (`plugin dev`)

Drives an end-to-end local development workflow using [RHDH Local](https://github.com/redhat-developer/rhdh-local) and Podman Compose or Docker Compose. The CLI exports the plugin, stages it into RHDH Local's bind-mounted plugin directory, manages containers, and waits for HTTP readiness.

```
┌──────────────────┐       plugin export       ┌────────────────────────┐
│  Plugin Project  │ ────────────────────────► │ local-plugins/<plugin> │
└──────────────────┘                           └───────────┬────────────┘
                                                           │
                                              Compose bind-mount + install
                                                           │
                                                           ▼
                                               ┌───────────────────────┐
                                               │   RHDH Local Runtime  │
                                               │   http://localhost    │
                                               └───────────────────────┘
```

### Prerequisites

1. An existing checkout of [RHDH Local](https://github.com/redhat-developer/rhdh-local).
2. Podman Compose (`podman-compose`) or Docker Compose (`docker compose`) installed and available on `PATH`.

Set the `RHDH_LOCAL_DIR` environment variable to avoid passing `--rhdh-local-dir` on every invocation:

```bash
export RHDH_LOCAL_DIR=/path/to/rhdh-local
```

### Lifecycle Subcommands

Run `rhdh-cli plugin dev <subcommand> [options]`:

| Subcommand        | Description                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `start` (default) | Build & export the plugin, stage into RHDH Local, start containers, and wait for readiness    |
| `update`          | Re-export and re-stage the plugin into the running runtime with readiness polling             |
| `restart`         | Restart the RHDH service without re-exporting the plugin (useful after modifying configs)     |
| `status`          | Report interpreted container and plugin-installer status                                      |
| `logs`            | Stream or display container logs (`--rhdh`, `--installer`, `--follow`)                        |
| `stop`            | Stop and remove RHDH Local runtime containers (add `--clean` to remove networks/staged files) |

### Automated Configuration with `--configure`

On initial startup, supply `--configure` to automatically register the plugin in RHDH Local's configuration:

```bash
rhdh-cli plugin dev start --configure --rhdh-local-dir /path/to/rhdh-local
```

`--configure` adds an include for `configs/dynamic-plugins/rhdh-cli.generated.local.yaml` to `dynamic-plugins.override.yaml` (which is gitignored in RHDH Local), leaving user-defined configuration untouched.

`start` prints labeled progress phases:

- `[1/4] Build and export plugin`
- `[2/4] Start RHDH Local runtime`
- `[3/4] Install dynamic plugins`
- `[4/4] Wait for RHDH readiness`

Once reachable, the CLI prints the URL to open in your browser:

```
RHDH is ready at http://localhost:7007
```

### Continuous Development with `--watch`

Pass `--watch` to keep the CLI running in the background. It monitors `src/`, `package.json`, and `tsconfig.json` and automatically triggers debounced, serialized export/stage/restart cycles whenever source files change:

```bash
# Start runtime and watch for changes
rhdh-cli plugin dev start --watch

# Or attach watcher to an already running runtime
rhdh-cli plugin dev update --watch
```

Features of watch mode:

- **Debounced (500ms):** Coalesces rapid sequential file saves into a single update cycle.
- **Serialized Cycles:** If changes occur while an update is actively running, exactly one follow-up cycle runs after completion.
- **Event-Driven Waits:** Listens to container lifecycle events (`die`/`start`) rather than polling raw subprocesses.
- **Readiness Notification:** Prompts you to refresh your browser only when RHDH is confirmed ready.

### Inspecting Runtime & Logs

```bash
# Check container and installer status
rhdh-cli plugin dev status

# Stream application logs
rhdh-cli plugin dev logs --follow

# Inspect installer logs if plugin failed to load
rhdh-cli plugin dev logs --installer
```

---

## Exporting & Packaging Plugins

### Dynamic Export (`plugin export`)

Prepares an exported dynamic plugin in `./dist-dynamic/` ready to be loaded by RHDH's dynamic plugin loader:

```bash
rhdh-cli plugin export
```

For frontend plugins:

- Uses Backstage's standard Module Federation and NFS metadata (`backstage.features`).
- Generates `dist/remoteEntry.js` and dynamic package manifests.

For backend plugins:

- Validates that `dist-types/` declarations exist (run `yarn tsc` first).
- Packages runtime dependencies and generates the dynamic plugin entry point.

### OCI Container Packaging (`plugin package`)

Packages exported plugins from `./dist-dynamic/` into a container image for distribution via registries like Quay.io:

```bash
# Package to local container image using Podman (default)
rhdh-cli plugin package --tag quay.io/my-org/my-plugin:v1.0.0

# Using Docker instead of Podman
rhdh-cli plugin package --tag quay.io/my-org/my-plugin:v1.0.0 --container-tool docker

# Package to a directory
rhdh-cli plugin package --export-to /path/to/output-dir
```

Requirements for `plugin package`:

- `bash`, `npm` (v7+), and `tar` available on `$PATH`.
- `podman`, `docker`, or `buildah` when packaging with `--tag`.

---

## Air-Gapped & Offline Operations

In air-gapped or restricted-network environments without access to `github.com` or `versions.backstage.io`, `rhdh-cli` supports fully offline execution:

1. **Supply a Local Backstage Manifest (`--manifest-file`):** Download the Backstage release manifest JSON (from `https://versions.backstage.io/v1/releases/<version>/manifest.json`) and point the CLI to it:

   ```bash
   rhdh-cli plugin check-versions --rhdh-version 2.1.0 --manifest-file /path/to/manifest.json
   rhdh-cli plugin upgrade 2.1.0 --manifest-file /path/to/manifest.json
   ```

   You can also set the `BACKSTAGE_MANIFEST_FILE` environment variable globally.

2. **Skip GitHub Metadata Lookups (`RHDH_OFFLINE=true`):** Set `RHDH_OFFLINE=true` to force the version resolver to use the embedded static compatibility matrix (Tier 2) and bypass remote network calls:

   ```bash
   export RHDH_OFFLINE=true
   export BACKSTAGE_MANIFEST_FILE=/path/to/manifest.json

   rhdh-cli plugin check-versions --rhdh-version 2.1.0
   rhdh-cli plugin upgrade 2.1.0
   ```

---

## Reporting Issues

Report bugs or feature requests through the Jira project: [Red Hat Developer Hub (RHIDP)](https://issues.redhat.com/projects/RHIDP/summary).

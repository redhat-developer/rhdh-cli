# rhdh-cli

## Build & Test Commands

- Build: `yarn build`
- Test all: `yarn test`
- Test single file: `yarn test -- --testPathPattern=src/path/to/file.test.ts`
- Lint: `yarn lint:check` (fix: `yarn lint:fix`)
- Lint single file: `npx eslint src/path/to/file.ts`
- Type check (full project): `yarn tsc`
- Type check single file: not supported — `tsconfig.json` extends Backstage's base config, so `tsc` must run project-wide; use `yarn tsc` and check for errors in the target file
- Prettier check: `yarn prettier:check` (fix: `yarn prettier:fix`)

## Pre-push Checklist

Run these before every commit that will be pushed to a PR branch:

```bash
yarn lint:check && yarn prettier:check && yarn tsc
```

Fix any issues with `yarn lint:fix` and `yarn prettier:fix` before committing.
SonarCloud runs on every push; address any new issues (typescript:S7772 `node:`
import prefix, typescript:S4624 nested template literals) before they accumulate.

## Key Conventions

- CLI command groups are co-located under `src/commands/intent-based-actions/`;
  register new groups in that directory's `index.ts`.
- Keep human/JSON rendering in `format.ts`, Backstage action invocation in
  `client.ts`, and command-level error presentation in `intent-errors.ts`.
- Add or update the co-located `*.test.ts` file when changing command behavior.
- **Use Commander subcommands, not positional arguments, when a command group
  has distinct actions with different option sets.** Positional arguments
  (e.g. `plugin dev [action]`) hide the available actions from `--help` and
  force every option to be shared across all actions, making some combinations
  nonsensical (e.g. `plugin dev status --configure`). Register each action as
  its own `.command('action')` with only the flags that apply to it. See
  `plugin dev` in `src/commands/index.ts` and `src/commands/dev/` for the
  reference implementation.

## CLI UX Design Conventions

- **Entity references**: Commands that target a single entity must accept a
  positional argument in `[kind:][namespace/]name` format (parsed by
  `parseEntityRef` / `resolveEntityRef` in `kv.ts`). Do not introduce
  per-command flags like `--entity-ref`, `--template-ref`, or
  `--name`/`--kind`/`--namespace` as the primary entity input. Optional
  `--kind` and `--namespace` flags may be offered to disambiguate short
  names, but the positional ref is the canonical interface.
- **Filter and input flags**: Use repeatable `--flag key=value` syntax
  (accumulated with `collect` and parsed by `resolveJsonInput` in `kv.ts`)
  instead of JSON string arguments. Example:
  `--filter kind=Component --filter spec.type=service`, not
  `--filters '{"kind":"Component"}'`.
- **Plugin dependencies**: Commands that depend on optional Backstage plugins
  (e.g., `techdocs-mcp-extras`, `search-backend-module-techdocs`) must detect
  when the plugin is not configured and exit with a clear error message
  suggesting how to enable it. Do not surface raw HTTP 400/500 responses.
- **Exit codes**: Commands must exit with a non-zero code when the requested
  entity is not found or the operation fails. Use `handleCommandError` from
  `intent-errors.ts` (which calls `process.exit(1)`) for all error paths.
  Informational "not found" messages must not exit 0.
- **Error presentation**: Use `intent-errors.ts` to extract human-readable
  reasons from Backstage error responses. Do not expose raw JSON schema
  validation output or full stack traces to the user. The `formatError`
  helper renders structured `{error, reason, suggestion}` objects in both
  human and JSON modes.
- **Help text**: Passthrough commands must surface the underlying tool's
  flags in `--help` output, not just the wrapper's flags.

## Architecture

- Intent-based commands invoke the bundled `@backstage/cli` through
  `backstage-cli actions execute`; they do not call Backstage HTTP APIs
  directly.
- `backstage-passthrough.ts` owns the lower-level `auth`, `actions`, and
  `sources` commands, while the other files wrap action execution with
  purpose-specific flags and output formatting.
- `docs list`, `docs get`, and `docs coverage` use the RHDH-only
  `techdocs-mcp-extras` actions. `docs search` uses the standard
  `search:query` action.

### `plugin new` — scaffold command

`src/commands/new/` owns the `rhdh-cli plugin new` command. It renders portable
template assets from the release-matched `@backstage/cli-module-new` package
rather than maintaining RHDH-owned template files.

Key files:

- `command.ts` — entry point, option parsing, template loading, and the
  RHDH standalone adapter (`adaptStandaloneProject`).
- `portableTemplateRenderer.ts` — Handlebars renderer that walks an upstream
  template directory and an optional RHDH overlay directory.
- `rhdhProfiles.ts` — per-release dependency profiles and role overlays.
  **Add a new profile here when targeting a new RHDH release.**

**Supported templates** are constrained to `supportedTemplateNames` in
`command.ts`. Only add a template name here after writing an e2e test for it
in `e2e-tests/plugin-new.test.ts` that covers scaffold → install → test →
build → export.

**RHDH template overlays** (`templates/plugin-new/<upstream-template-name>/`)
shadow individual upstream files that are incompatible with a specific RHDH
release without forking the full template. Each overlay file contains a
Handlebars comment explaining which upstream version it patches and the
condition under which it can be removed. When upgrading `@backstage/cli-module-new`
to a new version (i.e. adding a new RHDH release profile), audit every file
in `templates/plugin-new/` and remove overlays whose upstream has caught up.

### `plugin dev` — local runtime command

`src/commands/dev/` owns the `rhdh-cli plugin dev` subcommand group. It exports
the current plugin into an existing RHDH Local checkout and drives its Compose
runtime lifecycle.

Each action is a proper Commander subcommand with only the flags that apply to
it: `start`, `update`, `restart`, `stop`, `logs`, `status`. The subcommands are
registered in `src/commands/index.ts` and lazy-load their handlers from
`src/commands/dev/`.

`restart` stops and restarts the RHDH service only (no plugin re-export or
re-staging) — use it when changing RHDH Local configuration without touching
plugin code. `update` re-exports, re-stages, and then restarts the RHDH service.

Key files:

- `command.ts` — per-subcommand handlers (`start`, `update`, `restart`, `stop`,
  `logs`, `status`) plus all shared helpers: runtime validation, config
  management, plugin staging, Compose argument builders, and status formatting.
- `index.ts` — re-exports the six handlers for lazy-loading via
  `src/commands/index.ts`.

**Runtime contract:** `plugin dev` requires an explicit RHDH Local checkout via
`--rhdh-local-dir <path>` or the `RHDH_LOCAL_DIR` environment variable. It
validates the presence of `compose.yaml`, `compose-dynamic-plugins-root.yaml`,
`prepare-and-install-dynamic-plugins.sh`, and `wait-for-plugins-and-start.sh`.
It never touches Git-tracked files in the checkout and does not modify
user-owned configuration files (the `--configure` flag appends one include to
`dynamic-plugins.override.yaml`, but that file is gitignored in RHDH Local).

**Staging contract:** Plugins are staged to `local-plugins/<package-name>/`
inside the RHDH Local checkout. The RHDH Local installer picks them up via
`npm pack` from that path. The CLI writes its plugin entry to
`configs/dynamic-plugins/rhdh-cli.generated.local.yaml`; `--configure` adds
that file to `dynamic-plugins.override.yaml`'s `includes` list on first use.
`rhdh-cli.generated.local.yaml` matches the `*.local.yaml` gitignore pattern in
RHDH Local and will not appear in `git status` after a successful `start`.

**Pre-flight check:** `start` and `update` call `validateProjectFiles()` before
invoking `plugin export`. For backend plugins this checks that `dist-types/`
exists, failing fast with a clear `yarn tsc` instruction rather than letting
`yarn build` fail deep in the export process.

**Symlink handling:** `stagePlugin` uses `fs.remove` + `fs.copy` with
`dereference: false` so relative symlinks in `node_modules/.bin/` are preserved
as symlinks in the staged copy rather than followed, which would cause a
self-copy error on repeated `update` runs.

## Pattern References

- New command group: `src/commands/intent-based-actions/catalog.ts`
- Shared list/search command behavior: `src/commands/intent-based-actions/helpers.ts`
- Human/JSON output formatting: `src/commands/intent-based-actions/format.ts`
- Structured CLI errors: `src/commands/intent-based-actions/intent-errors.ts`
- Repeatable `key=value` and JSON input parsing: `src/commands/intent-based-actions/kv.ts`

## PR Conventions

- PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/) — enforced by CI (`pr-semantic.yaml`)
- Allowed types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`, `revert`
- Scopes are optional. If used, they must match `[\w$.\-* ]*` — no `#`, `@`, or other special characters. Do not put issue references (e.g., `#187`) in the scope position; reference issues in the PR body with `Closes #N` instead.
- Subjects must not start with an uppercase character
- Agent-assisted commits should include an `Assisted-by: <model>` footer

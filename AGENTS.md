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

## Key Conventions

- CLI command groups are co-located under `src/commands/intent-based-actions/`;
  register new groups in that directory's `index.ts`.
- Keep human/JSON rendering in `format.ts`, Backstage action invocation in
  `client.ts`, and command-level error presentation in `intent-errors.ts`.
- Add or update the co-located `*.test.ts` file when changing command behavior.

## CLI UX Design Conventions

- **Entity references**: Commands that target a single entity must accept a
  positional argument in `[kind:][namespace/]name` format (parsed by
  `parseEntityRef` in `kv.ts`, resolved via `resolveEntityWithAmbiguityCheck`
  in `helpers.ts` which adds catalog-based ambiguity detection). Do not
  introduce per-command flags like `--entity-ref`, `--template-ref`, or
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

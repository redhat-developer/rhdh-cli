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

- **RHDH-to-Backstage version mapping.** RHDH releases map to specific
  Backstage release versions. The primary lookup fetches
  `build-metadata.json` from the `redhat-developer/rhdh` GitHub repo
  (branch `release-X.Y`). When that fails (network error, missing
  branch), a static compatibility matrix in `src/lib/rhdhVersion.ts`
  (`RHDH_COMPATIBILITY_MATRIX`) provides the fallback. The matrix must
  be updated manually each RHDH release cycle. Bare numeric versions
  like `1.54.0` are treated as RHDH versions — to target a Backstage
  version directly, users must use the `backstage:` prefix (e.g.
  `backstage:1.54.0`).
- **Offline vs air-gapped.** `RHDH_OFFLINE=true` (or `--offline`) skips
  only the GitHub metadata fetch (Tier 1 of version resolution). The
  Backstage release manifest is still fetched from
  `versions.backstage.io` (Tier 3). For true air-gapped environments,
  users must also supply `--manifest-file` (or `BACKSTAGE_MANIFEST_FILE`)
  pointing to a local copy of the manifest JSON.
- **Error signaling.** Command handlers signal non-zero exit by throwing
  `ExitCodeError` from `src/lib/errors.ts`. The `lazy()` wrapper in
  `src/commands/index.ts` catches these and calls `process.exit(code)`.
  Do not call `process.exit()` directly from command handler code —
  throw `ExitCodeError` instead so tests can assert on the error without
  killing the process.

## Architecture

- **Version resolution engine** (`src/lib/rhdhVersion.ts`). Core
  abstraction that resolves an RHDH version alias (e.g. `2.1.0`,
  `latest`, `next`) to its underlying Backstage release version and
  package manifest. Uses a 3-tier strategy:
  1. **Remote metadata** — fetches `build-metadata.json` from the RHDH
     GitHub repo for the matching release branch.
  2. **Static matrix** — `RHDH_COMPATIBILITY_MATRIX`, an embedded
     `Record<string, string>` mapping RHDH versions to Backstage
     versions. Used when remote lookup fails or offline mode is active.
  3. **Backstage manifest** — fetches the release manifest from
     `versions.backstage.io` (or a local file) using
     `@backstage/release-manifests` to get the full package version map.
     Results are cached by a composite key of version + base URL + offline
     flag, so repeated calls within a session do not re-fetch.
- **Manifest caching** (`src/lib/backstageVersion.ts`). Caches the
  Backstage release manifest keyed by version + `versionsBaseUrl`.
  Supports `BACKSTAGE_MANIFEST_FILE` for local file override and
  `BACKSTAGE_VERSIONS_BASE_URL` for custom manifest servers —
  compatible with the upstream Backstage yarn plugin environment
  variables.
- **Command structure** (`src/commands/`). Each CLI command is a
  directory containing:

  - `command.ts` — exports the handler function (an
    `async (opts: OptionValues) => Promise<void>`)
  - `index.ts` — re-exports `{ command }` from `command.ts`
  - `command.test.ts` — co-located tests (when present)

  Commands are registered in `src/commands/index.ts` using Commander,
  with options declared inline and the action wired via
  `lazy(() => import('./command-dir').then(m => m.command))`.

- **Intent-based actions** (`src/commands/intent-based-actions/`).
  A separate registration path (`registerIntentCommands`) for
  passthrough commands that delegate to the Backstage CLI.

## Pattern References

- **New CLI command:** follow `src/commands/check-versions/command.ts`
  for the handler pattern (option parsing, calling a library function,
  formatting output, throwing `ExitCodeError` on failure) and
  `src/commands/check-versions/index.ts` for the re-export convention.
  Register the command in `src/commands/index.ts`.
- **Version resolution:** see `src/lib/rhdhVersion.ts` for the 3-tier
  resolution pattern (remote → static matrix → manifest) and how to
  extend the compatibility matrix.
- **Test patterns with mocked fetch:** see
  `src/lib/rhdhVersion.test.ts` — uses `setupFetchMock()` to stub
  `globalThis.fetch` with URL-based routing, `clearRhdhVersionCache()`
  / `clearManifestCache()` in `beforeEach`, and restores the original
  fetch in `afterEach`.
- **Backstage manifest utilities:** see
  `src/lib/backstageVersion.ts` for manifest fetching, caching, and
  `backstage:^` protocol resolution.

## PR Conventions

- PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/) — enforced by CI (`pr-semantic.yaml`)
- Allowed types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`, `revert`
- Scopes are optional. If used, they must match `[\w$.\-* ]*` — no `#`, `@`, or other special characters. Do not put issue references (e.g., `#187`) in the scope position; reference issues in the PR body with `Closes #N` instead.
- Subjects must not start with an uppercase character
- Agent-assisted commits should include an `Assisted-by: <model>` footer

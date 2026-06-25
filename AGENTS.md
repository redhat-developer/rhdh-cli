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
<!-- Add 2-3 conventions an agent couldn't discover by reading the code —
     e.g. co-location rules, naming patterns, file organisation decisions. -->

## Architecture
<!-- Add non-obvious architectural decisions or places where things live
     unexpectedly — e.g. why a module lives where it does, key abstractions,
     anything that would surprise a reader unfamiliar with the project. -->

## Pattern References
<!-- Point agents to 3-5 real examples for the most common change types.
     Example:
     - New CLI command: follow the pattern in `src/commands/config/show.ts`
     - New lib utility: see `src/lib/parallel.ts` as reference -->

## PR Conventions
- PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/) — enforced by CI (`pr-semantic.yaml`)
- Allowed types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`, `revert`
- Subjects must not start with an uppercase character
- Agent-assisted commits should include an `Assisted-by: <model>` footer

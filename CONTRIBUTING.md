# Contributing to rhdh-cli

Thank you for your interest in contributing to `@red-hat-developer-hub/cli`. This guide covers local development setup, coding conventions, the changelog workflow, and the release process.

## Table of Contents

- [Getting Started](#getting-started)
- [Coding Guidelines](#coding-guidelines)
- [Pull Request Conventions](#pull-request-conventions)
- [Changelog Discipline](#changelog-discipline)
- [Versioning Strategy](#versioning-strategy)
- [Release Process](#release-process)
- [Reporting Issues](#reporting-issues)

## Getting Started

### Prerequisites

- [nvm](https://github.com/nvm-sh/nvm) for Node.js version management
- [Yarn](https://yarnpkg.com/) via Corepack (see below)

### Clone and Set Up

```bash
git clone https://github.com/redhat-developer/rhdh-cli.git
cd rhdh-cli

# Use the Node version declared in .nvmrc
nvm install
nvm use

# Enable Corepack so Yarn is available at the pinned version
corepack enable

# Install dependencies
yarn install
```

### Build and Run Locally

```bash
yarn build
```

Run the CLI directly from the repository root:

```bash
./bin/rhdh-cli
```

### Running Tests

```bash
# Full test suite
yarn test

# Targeted test (avoid --runInBand; see AGENTS.md for details)
yarn backstage-cli package test --testPathPatterns='src/commands/new'
```

### Linting and Formatting

```bash
yarn lint:check          # Check for lint errors
yarn lint:fix            # Auto-fix lint errors
yarn prettier:check      # Check formatting
yarn prettier:fix        # Auto-fix formatting
yarn tsc                 # TypeScript type-check (project-wide)
```

Run the pre-push checklist before opening a PR:

```bash
yarn lint:check && yarn prettier:check && yarn tsc
```

## Coding Guidelines

- CLI command groups live under `src/commands/`. Register new command groups in `src/commands/index.ts`.
- Use Commander **subcommands** (not positional arguments) when a command group has distinct actions with different option sets. See `src/commands/dev/` for the reference implementation.
- Keep human/JSON rendering in `format.ts`, Backstage action invocation in `client.ts`, and command-level error presentation in `intent-errors.ts` for intent-based command groups.
- Add or update the co-located `*.test.ts` file when changing command behaviour.
- SonarCloud runs on every push; address new issues (particularly `typescript:S7772` `node:` import prefix and `typescript:S4624` nested template literals) before they accumulate.

## Pull Request Conventions

PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/), enforced by CI:

- Allowed types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`, `revert`
- Scopes are optional and must match `[\w$.\-* ]*` — no `#`, `@`, or other special characters
- Subjects must not start with an uppercase character
- Reference issues in the PR body with `Closes #N`, not in the scope position

Examples:

```
feat(plugin-dev): add restart subcommand
fix(plugin-export): validate version field before npm pack
chore: bump version to 2.1.1
docs: add CONTRIBUTING.md
```

Agent-assisted commits should include an `Assisted-by: <model>` footer.

## Changelog Discipline

We follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

**Do not bump the package version or add a versioned changelog entry in feature or fix PRs.** The version bump and CHANGELOG consolidation happen in a dedicated release PR (see [Release Process](#release-process) below). This keeps individual PRs focused and avoids the confusion of version numbers appearing in `package.json` before they are actually published to npm.

When writing changelog entries, add them under `## [Unreleased]` at the top of `CHANGELOG.md`, under the appropriate subsection (`Added`, `Changed`, `Fixed`, `Removed`). Include links to Jira issues and pull requests where relevant.

## Versioning Strategy

The versioning for rhdh-cli follows Semantic Versioning (`MAJOR.MINOR.PATCH`) and is aligned with the RHDH product:

- **Major and Minor (`MAJOR.MINOR`):** Synchronized with the corresponding RHDH release. If you are working with RHDH `2.1.z`, use rhdh-cli from the `2.1.z` series.
- **Patch (`PATCH`):** Incremented for CLI bug fixes and minor, non-breaking enhancements. The CLI patch version is not lock-stepped with RHDH patch releases — `2.1.0` and `2.1.1` are both valid for any RHDH `2.1.z` installation. Always use the latest available patch for your RHDH version.

**Do not release a MINOR or MAJOR version that is not aligned with the corresponding RHDH release.**

## Release Process

Releases are manual. The steps below describe how to prepare and publish a new version.

### 1. Open a release PR

Create a PR that does the following:

1. **Tidy `CHANGELOG.md`**: Move all `## [Unreleased]` entries to a new versioned heading:

   ```markdown
   ## 2.1.1 - YYYY-MM-DD
   ```

   Leave an empty `## [Unreleased]` placeholder at the top for the next cycle.

2. **Bump `package.json`**: Update the `"version"` field to the new version, following the [Versioning Strategy](#versioning-strategy).

3. **PR title**: `chore: bump version to X.Y.Z`

Merge the PR after CI passes and it has been reviewed.

### 2. Trigger the publish workflow

Publishing is done via the [Publish Package to NPM](https://github.com/redhat-developer/rhdh-cli/actions/workflows/publish.yaml) GitHub Actions workflow.

> **Important:** The workflow is not triggered automatically. It must be run manually.

Steps:

1. Go to the [Actions tab](https://github.com/redhat-developer/rhdh-cli/actions/workflows/publish.yaml).
2. Click **Run workflow**.
3. In the **Use workflow from** dropdown, select **`main`** (always run the latest workflow definition from `main`).
4. In the **Branch** input, enter the branch to publish from (typically `main` for the `next` dist-tag, or a `release-X.Y` branch for a GA release).
5. Click **Run workflow**.

#### NPM dist-tags

The workflow assigns npm dist-tags automatically based on the branch:

| Branch                                   | Dist-tag                          | Example                                                           |
| ---------------------------------------- | --------------------------------- | ----------------------------------------------------------------- |
| `main`                                   | `next`                            | `npm install @red-hat-developer-hub/cli@next`                     |
| Latest GA release branch (auto-detected) | `latest` + branch name            | `npm install @red-hat-developer-hub/cli@latest` or `@release-2.1` |
| Older release branches                   | Branch name (e.g., `release-1.9`) | `npm install @red-hat-developer-hub/cli@release-1.9`              |

The latest GA branch is auto-detected as the `release-*` branch with the highest semver version. Plugin builders targeting a specific RHDH version should use a semver range (e.g., `~2.1.0`) or the corresponding branch tag rather than `latest`.

### Bumping Backstage Dependencies

To update `@backstage/*` dependencies to a new Backstage release:

1. Update the `--release` version in the `backstage:bump` script in `package.json` to the target Backstage release version.
2. Review the `resolutions` section in `package.json` and update any pinned versions if needed.
3. Run the bump:

   ```bash
   yarn backstage:bump
   ```

   This updates all `@backstage/*` packages, pins them with `~` (tilde) ranges, keeps `@backstage/cli*` packages at exact versions, and runs `yarn install && yarn dedupe`.

4. Verify the build and tests still pass:

   ```bash
   yarn build && yarn tsc && yarn test
   ```

5. Update `RHDH_COMPATIBILITY_MATRIX` in `src/lib/rhdhVersion.ts` with the new RHDH-to-Backstage mapping before releasing the corresponding CLI version.

## Reporting Issues

Report bugs and feature requests through the [Red Hat Developer Hub Jira project (RHIDP)](https://issues.redhat.com/projects/RHIDP/summary).

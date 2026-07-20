# @red-hat-developer-hub/cli

This repository hosts the source code for the rhdh-cli utility, a new command-line interface designed to streamline the development, packaging, and distribution of dynamic plugins for Red Hat Developer Hub (RHDH).

This new CLI aims to offer more flexibility and ease of use compared to the previous @janus-idp/cli.

<!-- prettier breaks the formating for GitHub Markdown callout, this is why this whole block is ignored -->
<!-- prettier-ignore-start -->
> [!TIP]
> **Command Migration**
>
> If you were previously using @janus-idp/cli, here are the corresponding new commands in rhdh-cli:
>
> | Old Command                                          | New Command                                     |
> | ---------------------------------------------------- | ----------------------------------------------- |
> | `npx @janus-idp/cli package export-dynamic-plugin`   | `npx @red-hat-developer-hub/cli plugin export`  |
> | `npx @janus-idp/cli package package-dynamic-plugins` | `npx @red-hat-developer-hub/cli plugin package` |
<!-- prettier-ignore-end -->

## `plugin package` requirements

The `plugin package` command stages each `dist-dynamic` plugin with `npm pack` and `tar` (via a short bash script). The following must be available on your `PATH`:

- **bash** — runs the pack/extract script
- **npm** (7 or newer) — `npm pack --pack-destination` requires npm 7+
- **tar** — extracts the packed tarball into the staging directory

On Windows, use Git Bash or WSL so these tools are available.

When you build an OCI image with `--tag` (instead of exporting to a directory with `--export-to`), a container build tool must also be on `PATH`. **podman** is the default; you can select **docker** or **buildah** with `--container-tool` (for example `--container-tool docker`). Directory-only exports with `--export-to` do not need a container tool.

## Development

### Contributing

### Build and Run Locally

To build the project locally:

```bash
yarn install
yarn build
```

You can run the CLI locally by pointing to the `bin/rhdh-cli` file:

```bash
./bin/rhdh-cli
```

or when executing from the project root you can also use:

```bash
npx @red-hat-developer-hub/cli
```

### Bumping Backstage Dependencies

To update the `@backstage/*` dependencies to a new Backstage release:

1. Update the `--release` version in the `backstage:bump` script in `package.json` to the target Backstage release version.
2. Check the `resolutions` section in `package.json` and update any pinned versions if needed.
3. Run the bump:

```bash
yarn backstage:bump
```

This will update all `@backstage/*` packages, pin them with `~` (tilde) ranges, keep `@backstage/cli*` packages at exact versions, and run `yarn install && yarn dedupe`.

After bumping, verify the build and tests still pass:

```bash
yarn build
yarn tsc
yarn test
```

### Versioning Strategy

The versioning for rhdh-cli is designed to be straightforward and align directly with the main Red Hat Developer Hub (RHDH) product, ensuring a clear compatibility path for developers.

Our versioning scheme follows the pattern of `$MAJOR.$MINOR.$PATCH` (e.g., 1.8.0).

- **Major and Minor Version ($MAJOR.$MINOR)**: This part of the version is synchronized with the corresponding RHDH release. For example, if you are working with RHDH `1.8.z`, you should use a version of `rhdh-cli` from the `1.8.z` series. This direct alignment removes ambiguity and the need to maintain a separate compatibility matrix.

- **Patch Version ($PATCH)**: The patch version is incremented for new releases of the CLI that contain bug fixes or minor, non-breaking feature enhancements specific to the CLI. The patch version of `rhdh-cli` is not lock-stepped with RHDH's patch releases. For instance, `rhdh-cli` versions `1.8.0` and `1.8.1` are both intended for use with any RHDH `1.8.z` installation. We always recommend using the latest available patch release for your RHDH version.

### Publishing to NPM

Publishing is done using [Publish Package to NPM](.github/workflows/publish.yaml) workflow.

**Make sure not to release MINOR or MAJOR version that are not aligned with the corresponding RHDH release.**

This workflow is **not** currently triggered automatically. It needs to be run manually from the [Actions tab](https://github.com/redhat-developer/rhdh-cli/actions/workflows/publish.yaml) in the GitHub repository. Always run the workflow from the `main` branch (the "Use workflow from" dropdown) and select the target release branch via the `branch` input parameter. This ensures the latest workflow definition is used.

#### NPM dist-tags

The workflow automatically assigns npm dist-tags based on the selected branch:

| Branch | Dist-tag | Example |
| --- | --- | --- |
| `main` | `next` | `npm install @red-hat-developer-hub/cli@next` |
| Latest GA release branch (auto-detected) | `latest` + branch name | `npm install @red-hat-developer-hub/cli@latest` or `@release-1.10` |
| Older release branches | Branch name (e.g., `release-1.9`) | `npm install @red-hat-developer-hub/cli@release-1.9` |

The latest GA branch is auto-detected as the `release-*` branch with the highest semver version. Plugin builders targeting a specific RHDH version should use a semver range (e.g., `~1.10.0`) or the corresponding branch tag rather than `latest`.

## Reporting Issues

If you encounter any bugs or have feature requests, please report them through our Jira Project [Red Hat Developer Hub (RHIDP)](https://issues.redhat.com/projects/RHIDP/summary)

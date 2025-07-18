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

## Development

### Contributing

### Build nad Run Locally

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

### Versioning Strategy

The versioning for rhdh-cli is designed to be straightforward and align directly with the main Red Hat Developer Hub (RHDH) product, ensuring a clear compatibility path for developers.

Our versioning scheme follows the pattern of `$MAJOR.$MINOR.$PATCH` (e.g., 1.8.0).

- **Major and Minor Version ($MAJOR.$MINOR)**: This part of the version is synchronized with the corresponding RHDH release. For example, if you are working with RHDH `1.8.z`, you should use a version of `rhdh-cli` from the `1.8.z` series. This direct alignment removes ambiguity and the need to maintain a separate compatibility matrix.

- **Patch Version ($PATCH)**: The patch version is incremented for new releases of the CLI that contain bug fixes or minor, non-breaking feature enhancements specific to the CLI. The patch version of `rhdh-cli` is not lock-stepped with RHDH's patch releases. For instance, `rhdh-cli` versions `1.8.0` and `1.8.1` are both intended for use with any RHDH `1.8.z` installation. We always recommend using the latest available patch release for your RHDH version.

### Publishing to NPM

Publishing is done using [Publish Package to NPM](.github/workflows/publish.yaml) workflow.

**Make sure not to release MINOR or MAJOR version that are not aligned with the corresponding RHDH release.**

This workflow is **not** currently triggered automatically. It needs to be run manually from the [Actions tab](https://github.com/redhat-developer/rhdh-cli/actions/workflows/publish.yaml) in the GitHub repository.

## Reporting Issues

If you encounter any bugs or have feature requests, please report them through our Jira Project [Red Hat Developer Hub (RHIDP)](https://issues.redhat.com/projects/RHIDP/summary)

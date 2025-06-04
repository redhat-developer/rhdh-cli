# Contributing

## Build nad Run Locally

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

## Opening Pull Requests

This project uses [Changesets](https://github.com/changesets/changesets) for version and changelog management.

If your PR includes changes that affect the public interface (CLI, API, etc.) or user-facing features, you should create a changeset to document these changes.

This is done using the Changesets CLI:

```bash
yarn changeset
```

The changeset will be saved as a markdown file in the `.changeset/` directory and should be committed with your changes.

## Versioning

When changes with changesets are merged to the `main` branch, the **[Create Version Pull Request](.github/workflows/create-version-pr.yaml)** workflow is triggered automatically.

This workflow creates a new PR `Version Packages` (or update it if one already exists). This will bump the version of the package based on the changesets and update the changelog.

## Publishing to NPM

Publishing is done using [Publish Package to NPM](.github/workflows/publish.yaml) workflow.

This workflow is **not** currently triggered automatically. It needs to be run manually from the [Actions tab](https://github.com/redhat-developer/rhdh-cli/actions/workflows/publish.yaml) in the GitHub repository.


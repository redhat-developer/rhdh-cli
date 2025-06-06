# @red-hat-developer-hub/cli

This repository hosts the source code for the rhdh-cli utility, a new command-line interface designed to streamline the development, packaging, and distribution of dynamic plugins for Red Hat Developer Hub (RHDH).

This new CLI aims to offer more flexibility and ease of use compared to the previous @janus-idp/cli.

> [!TIP]
> **Command Migration**
>
> If you were previously using @janus-idp/cli, here are the corresponding new commands in rhdh-cli:
>
> | Old Command                                          | New Command                                     |
> | ---------------------------------------------------- | ----------------------------------------------- |
> | `npx @janus-idp/cli package export-dynamic-plugin`   | `npx @red-hat-developer-hub/cli plugin export`  |
> | `npx @janus-idp/cli package package-dynamic-plugins` | `npx @red-hat-developer-hub/cli plugin package` |

## Contributing

For information on how to contribute, build and release, please see the [contributing guide](CONTRIBUTING.md).

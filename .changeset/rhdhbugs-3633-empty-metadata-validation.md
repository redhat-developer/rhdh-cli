---
'@red-hat-developer-hub/cli': patch
---

Prevent publishing OCI images with empty plugin registry metadata (RHDHBUGS-3633). The `plugin package` command now fails immediately if any plugin export fails or does not produce the expected `dist-dynamic` directory. Previously, export failures were logged but did not stop the packaging process, and if all exports failed, the command would still create and publish an OCI image with an empty `io.backstage.dynamic-packages` annotation, causing silent installation failures in RHDH. This fail-fast behavior matches the `export-dynamic.sh` script used in CI.

---
'@red-hat-developer-hub/cli': minor
---

Add RHDH version resolution engine and `rhdh-cli plugin check-versions` (alias `plugin versions:lint`) command (RHIDP-16665, RHIDP-16667).

- Resolves RHDH release versions to Backstage release manifests using a 3-tier resolution strategy (remote GitHub build-metadata, embedded static compatibility matrix fallback, and Backstage release manifests).
- Adds `rhdh-cli plugin check-versions` (alias `rhdh-cli plugin versions:lint`) to audit `@backstage/*` dependencies in `package.json` against the target RHDH release manifest, with support for human-readable tabular output, JSON output, and offline mode.

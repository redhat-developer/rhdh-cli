# RHDH CLI - Intent-Based Commands Documentation

Complete guide for using `rhdh-cli` to interact with Red Hat Developer Hub instances.

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [RHDH Instance Configuration](#rhdh-instance-configuration)
- [Authentication](#authentication)
- [Register Action Sources](#register-action-sources)
- [Command to Action Mapping](#command-to-action-mapping)
- [Commands Reference](#commands-reference)
  - [Catalog Commands](#catalog-commands)
  - [API Commands](#api-commands)
  - [Search Commands](#search-commands)
  - [TechDocs Commands](#techdocs-commands)
  - [Template Commands](#template-commands)
  - [Auth Commands](#auth-commands)
  - [Actions Commands](#actions-commands)
- [Common Workflows](#common-workflows)
- [Output Modes](#output-modes)
- [Agent Integration](#agent-integration)
- [Troubleshooting](#troubleshooting)

## Overview

`rhdh-cli` provides intent-based commands for querying and managing RHDH catalog entities, API specifications, TechDocs content, and software templates. All commands support both human-readable output (default) and structured JSON output (`--output json`) for automation and AI agents.

**Key Features:**

- **No local project context required** - Works standalone after authentication
- **Self-documenting** - `--help` provides complete command documentation
- **Agent-friendly** - JSON output mode with structured error messages
- **Multi-instance support** - Manage multiple RHDH environments

## Installation

```bash
# Via npx (recommended for one-off use)
npx @red-hat-developer-hub/cli

# Via global install
npm install -g @red-hat-developer-hub/cli
rhdh-cli --help
```

## RHDH Instance Configuration

Before using the CLI, your RHDH instance requires specific configuration.

### 1. Enable the Auth Plugin

The `rhdh-cli auth login` flow requires the `@backstage/plugin-auth` frontend plugin to serve the OAuth2 consent page. RHDH does not include this plugin by default.

Install it as a dynamic plugin from `rhdh-plugin-export-overlays`:

```yaml
# dynamic-plugins.yaml
plugins:
  - package: 'oci://ghcr.io/redhat-developer/rhdh-plugin-export-overlays/backstage-plugin-auth:bs_1.49.4__0.1.6'
    disabled: false
    pluginConfig:
      dynamicPlugins:
        frontend:
          backstage.plugin-auth:
            dynamicRoutes:
              - path: /oauth2/*
                importName: Router
```

### 2. Enable OAuth2 Server Endpoints

Add to `app-config.local.yaml`:

```yaml
auth:
  experimentalClientIdMetadataDocuments:
    enabled: true
  experimentalRefreshToken:
    enabled: true
```

### 3. Enable TechDocs MCP Extras Plugin (Optional)

To use TechDocs actions (`docs list`, `docs get`, `docs coverage`), install the TechDocs MCP extras plugin:

```yaml
# dynamic-plugins.yaml
plugins:
  - package: oci://ghcr.io/redhat-developer/rhdh-plugin-export-overlays/red-hat-developer-hub-backstage-plugin-techdocs-mcp-extras:bs_1.49.4__0.2.3
    disabled: false
```

**Note:** The `docs search` command works without this plugin. Only `docs list`, `docs get`, and `docs coverage` require it.

## Authentication

Authenticate with your RHDH instance:

```bash
rhdh-cli auth login --rhdh-url https://rhdh.example.com
```

You can also use `--backend-url` as an alias:

```bash
rhdh-cli auth login --backend-url https://rhdh.example.com
```

This opens a browser for OAuth2 consent. After approval, credentials are stored locally.

**Verify authentication:**

```bash
rhdh-cli auth show
```

### Managing Multiple Instances

```bash
# List all authenticated instances
rhdh-cli auth list

# Select active instance (interactive)
rhdh-cli auth select

# Login with instance name
rhdh-cli auth login --rhdh-url https://rhdh-prod.example.com --instance production

# Use specific instance for a command
rhdh-cli catalog list --kind Component --instance production
```

## Register Action Sources

The CLI maintains its own client-side source list. Register sources for the plugins available on your instance:

```bash
rhdh-cli actions sources add catalog
rhdh-cli actions sources add scaffolder
rhdh-cli actions sources add search
rhdh-cli actions sources add auth
rhdh-cli actions sources add notifications
rhdh-cli actions sources add techdocs-mcp-extras  # If plugin is installed
```

**Verify registration:**

```bash
rhdh-cli actions sources list
```

**Important Notes:**

- Source registration is per-instance. Switching instances with `auth select` requires re-adding sources.
- Only add sources for plugins that have the actions backend endpoint.
- Adding a source for a plugin without it causes `actions list` to fail entirely.

## Command to Action Mapping

The following table shows how intent-based CLI commands map to underlying Backstage actions:

| Command              | Action ID                                       | Notes                                                                                        |
| -------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `catalog list`       | `catalog:query-catalog-entities`                | Supports `--kind`, `--type`, `--filter` (repeatable), `--limit`, `--fields`                  |
| `catalog get`        | `catalog:get-catalog-entity`                    | Requires `--name`, optional `--kind`, `--namespace`                                          |
| `catalog validate`   | `catalog:validate-entity`                       | Accepts `--entity` or `--entity-file`                                                        |
| `catalog register`   | `catalog:register-entity`                       | Requires `--location-url`                                                                    |
| `catalog unregister` | `catalog:unregister-entity`                     | Requires `--location-id` or `--location-url`                                                 |
| `api list`           | `catalog:query-catalog-entities`                | Hardcoded `kind=API`, supports `--type`, `--filter` (repeatable)                             |
| `api get-spec`       | `catalog:get-catalog-entity`                    | Extracts `spec.definition` from API entity                                                   |
| `search <term>`      | `search:query`                                  | Supports `--types`, `--page-limit`, `--page-cursor`                                          |
| `docs search <term>` | `search:query`                                  | Hardcoded `types=["techdocs"]`                                                               |
| `docs list`          | `techdocs-mcp-extras:fetch-techdocs`            | RHDH only, requires plugin; supports `--kind`, `--owner`, `--lifecycle`, `--tags`, `--limit` |
| `docs get`           | `techdocs-mcp-extras:retrieve-techdocs-content` | RHDH only, requires plugin                                                                   |
| `docs coverage`      | `techdocs-mcp-extras:analyze-techdocs-coverage` | RHDH only, requires plugin                                                                   |
| `template list`      | `catalog:query-catalog-entities`                | Hardcoded `kind=Template`, supports `--filter` (repeatable)                                  |
| `template execute`   | `scaffolder:execute-template`                   | Requires `--template-ref`; `--value` (repeatable) and `--secret` (repeatable) are optional   |
| `template dry-run`   | `scaffolder:dry-run-template`                   | Requires `--template-file`; `--value` (repeatable) is optional; reads YAML from disk         |
| `auth *`             | Pass-through to `backstage-cli auth *`          | Output rebranded as `rhdh-cli`                                                               |
| `actions *`          | Pass-through to `backstage-cli actions *`       | Output rebranded as `rhdh-cli`                                                               |

**Note:** Commands marked "RHDH only" require the `techdocs-mcp-extras` plugin to be installed on your RHDH instance. See [RHDH Instance Configuration](#rhdh-instance-configuration) for setup instructions.

## Commands Reference

All commands support:

- `--help` for detailed usage information
- `--output json` for machine-readable structured output
- `--instance <name>` to target a specific authenticated RHDH instance

### Catalog Commands

Query and manage the RHDH software catalog.

#### `catalog list`

List catalog entities with filtering and field selection.

```bash
# List all components
rhdh-cli catalog list --kind Component

# Filter by type and lifecycle
rhdh-cli catalog list --kind Component --type service --filter spec.lifecycle=production

# Multiple filters
rhdh-cli catalog list \
  --kind Component \
  --type service \
  --filter spec.lifecycle=production \
  --filter spec.owner=team-platform

# Limit results
rhdh-cli catalog list --kind Component --limit 50

# Select specific fields
rhdh-cli catalog list --kind Component --fields metadata.name,spec.owner,spec.lifecycle

# JSON output for automation
rhdh-cli catalog list --kind Component --output json
```

**Options:**

- `--kind <kind>` - Entity kind (Component, API, System, User, Group, etc.)
- `--type <type>` - Entity type (service, website, library, etc.)
- `--filter <key=value>` - Query predicate (repeatable), e.g., `--filter spec.lifecycle=production`
- `--limit <n>` - Maximum results to return
- `--fields <list>` - Comma-separated fields to include
- `--output <format>` - Output format: `human` (default) or `json`
- `--instance <name>` - RHDH instance name

#### `catalog get`

Get a specific catalog entity by name.

```bash
# Get entity by name
rhdh-cli catalog get --name my-service --kind Component

# Specify namespace (defaults to 'default')
rhdh-cli catalog get --name my-api --kind API --namespace production

# JSON output
rhdh-cli catalog get --name my-service --kind Component --output json
```

**Options:**

- `--name <name>` - Entity name (required)
- `--kind <kind>` - Entity kind
- `--namespace <ns>` - Entity namespace (default: `default`)
- `--output <format>` - Output format
- `--instance <name>` - RHDH instance name

#### `catalog validate`

Validate entity YAML against the catalog schema.

```bash
# Validate from file
rhdh-cli catalog validate --entity-file ./catalog-info.yaml

# Validate inline YAML
rhdh-cli catalog validate --entity "apiVersion: backstage.io/v1alpha1..."

# With location
rhdh-cli catalog validate --entity-file ./catalog-info.yaml --location https://github.com/org/repo
```

**Options:**

- `--entity <yaml>` - Entity YAML content
- `--entity-file <path>` - Path to entity YAML file
- `--location <url>` - Location to validate
- `--output <format>` - Output format
- `--instance <name>` - RHDH instance name

#### `catalog register`

Register a catalog entity from a location URL.

```bash
# Register from GitHub
rhdh-cli catalog register \
  --location-url https://github.com/myorg/myrepo/blob/main/catalog-info.yaml
```

**Options:**

- `--location-url <url>` - Location URL to register (required)
- `--output <format>` - Output format
- `--instance <name>` - RHDH instance name

#### `catalog unregister`

Unregister a catalog entity by location.

```bash
# Unregister by location ID
rhdh-cli catalog unregister --location-id <id>

# Unregister by location URL
rhdh-cli catalog unregister --location-url https://github.com/org/repo/blob/main/catalog-info.yaml
```

**Options:**

- `--location-id <id>` - Location ID to unregister
- `--location-url <url>` - Location URL to unregister
- `--output <format>` - Output format
- `--instance <name>` - RHDH instance name

### API Commands

Query API entities and retrieve specifications.

#### `api list`

List API entities in the catalog.

```bash
# List all APIs
rhdh-cli api list

# Filter by type
rhdh-cli api list --type openapi
rhdh-cli api list --type graphql

# Filter by owner
rhdh-cli api list --filter spec.owner=team-a

# Combine filters
rhdh-cli api list --type openapi --filter spec.lifecycle=production

# JSON output
rhdh-cli api list --output json
```

**Options:**

- `--type <type>` - API type (`openapi`, `asyncapi`, `graphql`, `grpc`)
- `--filter <key=value>` - Query predicate (repeatable)
- `--limit <n>` - Maximum results to return
- `--output <format>` - Output format
- `--instance <name>` - RHDH instance name

#### `api get-spec`

Get the full API specification (OpenAPI, AsyncAPI, GraphQL, gRPC).

```bash
# Get OpenAPI specification
rhdh-cli api get-spec --name my-api

# Save to file
rhdh-cli api get-spec --name my-api > openapi.yaml

# JSON output
rhdh-cli api get-spec --name my-api --output json
```

**Options:**

- `--name <name>` - API entity name (required)
- `--namespace <ns>` - Entity namespace (default: `default`)
- `--output <format>` - Output format
- `--instance <name>` - RHDH instance name

**Output:**

- Human mode: Raw specification (YAML or schema)
- JSON mode: `{"name": "...", "type": "openapi", "definition": "..."}`

### Search Commands

Search across catalog, TechDocs, and templates.

#### `search <term>`

Search all content types.

```bash
# Search everything
rhdh-cli search "deployment guide"

# Search specific types
rhdh-cli search "authentication" --types '["techdocs"]'
rhdh-cli search "component" --types '["software-catalog"]'

# Pagination
rhdh-cli search "query" --page-limit 20 --page-cursor <cursor>

# JSON output
rhdh-cli search "deployment" --output json
```

**Options:**

- `<term>` - Search term (required)
- `--types <json>` - Content types to search (JSON array)
- `--page-limit <n>` - Results per page (default: 10)
- `--page-cursor <cursor>` - Pagination cursor
- `--output <format>` - Output format
- `--instance <name>` - RHDH instance name

### TechDocs Commands

Search and retrieve TechDocs content.

#### `docs search <term>`

Search TechDocs content (via upstream `search:query`).

```bash
# Search TechDocs
rhdh-cli docs search "getting started"

# With pagination
rhdh-cli docs search "API reference" --page-limit 20

# JSON output
rhdh-cli docs search "deployment" --output json
```

**Options:**

- `<term>` - Search term (required)
- `--page-limit <n>` - Results per page (default: 10)
- `--page-cursor <cursor>` - Pagination cursor
- `--output <format>` - Output format
- `--instance <name>` - RHDH instance name

#### `docs list`

List entities with TechDocs (RHDH only, requires `techdocs-mcp-extras` plugin).

```bash
# List all entities with docs
rhdh-cli docs list

# Filter by entity kind
rhdh-cli docs list --kind Component

# Filter by owner and lifecycle
rhdh-cli docs list --owner team-platform --lifecycle production

# Limit results
rhdh-cli docs list --limit 10

# JSON output
rhdh-cli docs list --output json
```

**Options:**

- `--kind <kind>` - Filter by entity kind (Component, API, etc.)
- `--owner <owner>` - Filter by owner
- `--lifecycle <lifecycle>` - Filter by lifecycle (production, experimental, etc.)
- `--tags <tags>` - Filter by tags (comma-separated)
- `--limit <n>` - Maximum results to return
- `--output <format>` - Output format
- `--instance <name>` - RHDH instance name

**Note:** Requires `techdocs-mcp-extras` plugin on RHDH instance.

#### `docs get`

Get TechDocs page content for an entity (RHDH only, requires `techdocs-mcp-extras` plugin).

```bash
# Get index page
rhdh-cli docs get --entity-ref component:default/my-service

# Get specific page
rhdh-cli docs get \
  --entity-ref component:default/my-service \
  --page-path architecture/overview

# Save to file
rhdh-cli docs get --entity-ref component:default/my-service > README.md

# JSON output
rhdh-cli docs get --entity-ref component:default/my-service --output json
```

**Options:**

- `--entity-ref <ref>` - Entity reference, e.g., `component:default/my-service` (required)
- `--page-path <path>` - Specific doc page path (default: index)
- `--output <format>` - Output format
- `--instance <name>` - RHDH instance name

**Output:**

- Human mode: Plain text content (HTML stripped)
- JSON mode: `{"entityRef": "...", "content": "...", "pageTitle": "...", "metadata": {...}}`

**Note:** Requires `techdocs-mcp-extras` plugin on RHDH instance.

#### `docs coverage`

Show TechDocs coverage report (RHDH only, requires `techdocs-mcp-extras` plugin).

```bash
# Get coverage report
rhdh-cli docs coverage

# JSON output
rhdh-cli docs coverage --output json
```

**Options:**

- `--output <format>` - Output format
- `--instance <name>` - RHDH instance name

**Output:**

```
TechDocs Coverage Report

Total entities:       150
Documented entities:  120
Coverage:             80%
```

**Note:** Requires `techdocs-mcp-extras` plugin on RHDH instance.

### Template Commands

List and execute software templates.

#### `template list`

List available software templates.

```bash
# List all templates
rhdh-cli template list

# Filter by tags
rhdh-cli template list --filter metadata.tags=nodejs

# Filter by owner
rhdh-cli template list --filter spec.owner=team-platform

# Limit results
rhdh-cli template list --limit 20

# JSON output
rhdh-cli template list --output json
```

**Options:**

- `--filter <key=value>` - Query predicate (repeatable)
- `--limit <n>` - Maximum results to return
- `--output <format>` - Output format
- `--instance <name>` - RHDH instance name

#### `template execute`

Execute a software template.

```bash
# Execute with key-value pairs
rhdh-cli template execute \
  --template-ref template:default/nodejs-service \
  --value name=my-app \
  --value owner=team-a

# Execute with multiple values
rhdh-cli template execute \
  --template-ref template:default/react-app \
  --value name=my-app \
  --value owner=team-frontend \
  --value port=3001

# With secrets (use with caution - visible in process list)
rhdh-cli template execute \
  --template-ref template:default/my-template \
  --value name=my-app \
  --secret token=abc123

# JSON output
rhdh-cli template execute \
  --template-ref template:default/my-template \
  --value name=my-app \
  --output json
```

**Options:**

- `--template-ref <ref>` - Template entity ref, e.g., `template:default/my-template` (required)
- `--value <key=value>` - Template input value (repeatable)
- `--secret <key=value>` - Template secret (repeatable)
- `--output <format>` - Output format
- `--instance <name>` - RHDH instance name

**Security Warning:** `--secret` flags are visible in process lists on shared systems. Use with caution.

#### `template dry-run`

Validate a software template without making changes.

```bash
# Dry-run from file
rhdh-cli template dry-run \
  --template-file ./template.yaml \
  --value name=test-app \
  --value owner=test-team

# JSON output
rhdh-cli template dry-run \
  --template-file ./template.yaml \
  --value name=test-app \
  --output json
```

**Options:**

- `--template-file <path>` - Path to template YAML file (required)
- `--value <key=value>` - Template input value (repeatable)
- `--output <format>` - Output format
- `--instance <name>` - RHDH instance name

### Auth Commands

Manage authenticated RHDH instances.

```bash
# Login to RHDH instance
rhdh-cli auth login --rhdh-url https://rhdh.example.com

# Alternative: use --backend-url
rhdh-cli auth login --backend-url https://rhdh.example.com

# Login with instance name
rhdh-cli auth login --rhdh-url https://rhdh.example.com --instance production

# List authenticated instances
rhdh-cli auth list

# Select active instance
rhdh-cli auth select

# Show current instance details
rhdh-cli auth show

# Print access token
rhdh-cli auth print-token

# Logout
rhdh-cli auth logout
```

**Note:** Both `--rhdh-url` and `--backend-url` flags are supported for `login`.

### Actions Commands

List and execute RHDH actions directly.

```bash
# List available actions on the RHDH instance
rhdh-cli actions list

# Execute an action directly
rhdh-cli actions execute catalog:query-catalog-entities --query '{"kind":"Component"}'

# Manage action sources
rhdh-cli actions sources list
rhdh-cli actions sources add <source>
rhdh-cli actions sources remove <source>
```

**Note:** Intent-based commands (`catalog`, `api`, `docs`, `template`) are recommended over direct action execution for better usability and error messages.

## Common Workflows

### Workflow 1: Find All Production Services

```bash
rhdh-cli catalog list \
  --kind Component \
  --type service \
  --filter spec.lifecycle=production \
  --fields metadata.name,spec.owner,metadata.description \
  --output json
```

### Workflow 2: Get API Specification for Integration

```bash
# 1. Find the API
rhdh-cli api list --type openapi --output json

# 2. Get the OpenAPI spec
rhdh-cli api get-spec --name my-api --output json
```

### Workflow 3: Search Documentation and Retrieve Content

```bash
# 1. Search for relevant docs
rhdh-cli docs search "deployment" --output json

# 2. Get specific doc page (RHDH only)
rhdh-cli docs get --entity-ref component:default/my-service --page-path deployment
```

### Workflow 4: Validate and Register New Entity

```bash
# 1. Validate locally
rhdh-cli catalog validate --entity-file ./catalog-info.yaml --output json

# 2. Register if valid
rhdh-cli catalog register \
  --location-url https://github.com/org/repo/blob/main/catalog-info.yaml
```

### Workflow 5: Create New Service from Template

```bash
# 1. Browse available templates
rhdh-cli template list

# 2. Execute template
rhdh-cli template execute \
  --template-ref template:default/nodejs-microservice \
  --value name=payment-service \
  --value description="Payment processing service" \
  --value owner=team-payments \
  --value port=8080
```

## Output Modes

All commands support two output modes:

### Human-Readable Mode (Default)

Formatted for CLI use with colors, tables, and readable text.

```bash
rhdh-cli catalog list --kind Component
```

### JSON Mode

Structured output for automation, scripting, and AI agents.

```bash
rhdh-cli catalog list --kind Component --output json
```

**JSON Error Format:**

```json
{
  "error": "Error message",
  "reason": "Detailed explanation",
  "suggestion": "rhdh-cli catalog list --kind Component"
}
```

**Exit Codes:**

- `0` - Success
- Non-zero - Error occurred (check stderr and JSON error object)

## Agent Integration

### Best Practices for AI Agents

1. **Always use JSON output:** `--output json` for all commands
2. **Parse errors from JSON:** Check for `error` field in response
3. **Use specific filters:** Leverage `--kind`, `--type`, `--filter` to reduce result size
4. **Respect pagination:** Use `--limit` and cursor-based pagination for large result sets
5. **Handle field selection:** Use `--fields` to retrieve only needed data
6. **Instance-specific queries:** Use `--instance` when working with multiple RHDH environments
7. **Error recovery:** Parse `suggestion` field from error responses for corrective actions

### Discovery via --help

All commands support `--help` for complete documentation:

```bash
rhdh-cli --help
rhdh-cli catalog --help
rhdh-cli catalog list --help
rhdh-cli api get-spec --help
```

The `--help` output is the complete protocol contract — agents can operate from help text alone without external documentation.

### Example Agent Workflow

```bash
# 1. Authenticate
rhdh-cli auth login --rhdh-url https://rhdh.example.com

# 2. Register action sources
rhdh-cli actions sources add catalog
rhdh-cli actions sources add scaffolder

# 3. Query entities
rhdh-cli catalog list \
  --kind Component \
  --filter spec.lifecycle=production \
  --fields metadata.name,spec.owner \
  --output json | jq '.entities[].metadata.name'

# 4. Get API spec
rhdh-cli api get-spec --name my-api --output json | jq '.definition'

# 5. Execute template
rhdh-cli template execute \
  --template-ref template:default/service \
  --value name=new-service \
  --value owner=team-a \
  --output json
```

## Troubleshooting

### Authentication Errors

```bash
# Check current auth status
rhdh-cli auth show

# Re-authenticate
rhdh-cli auth login --rhdh-url https://rhdh.example.com

# If using wrong RHDH instance, select the right one
rhdh-cli auth select
```

### Action Not Found

If a command reports an action is not available:

- Ensure your RHDH instance version is 1.10 or newer
- Verify required plugins are installed on the RHDH instance (e.g., `techdocs-mcp-extras` for `docs list/get/coverage`)
- Check that action sources are registered: `rhdh-cli actions sources list`
- Use `rhdh-cli actions list` to see all available actions on the connected RHDH instance

### TechDocs Commands Failing

If `docs list`, `docs get`, or `docs coverage` fail:

- These commands require the `techdocs-mcp-extras` plugin on your RHDH instance
- Verify the plugin is installed and enabled on the RHDH instance
- Check server-side configuration in `app-config.local.yaml`
- Verify client-side source registration: `rhdh-cli actions sources list` should show `techdocs-mcp-extras`
- Use `docs search` as an alternative, which works with all RHDH instances

### Output Parsing Issues

If JSON output is malformed:

- Check for errors on stderr
- Verify exit code (0 = success)
- Ensure you included `--output json` flag

### Large Result Sets

For catalogs with many entities:

```bash
# Use limits
rhdh-cli catalog list --kind Component --limit 100

# Use specific filters
rhdh-cli catalog list \
  --kind Component \
  --type service \
  --filter spec.lifecycle=production

# Select only needed fields
rhdh-cli catalog list \
  --kind Component \
  --fields metadata.name,spec.owner
```

### Multiple Instance Confusion

```bash
# Check which instance is active
rhdh-cli auth show

# List all instances
rhdh-cli auth list

# Switch instance
rhdh-cli auth select

# Or use --instance flag for one-off commands
rhdh-cli catalog list --kind Component --instance production
```

# ADR-0021: MCP Server for External Agent Integration

## Status

Accepted (design only — implementation deferred to v0.2.0)

## Context

External AI agents (Claude Code, Cursor, Codex, OpenClaw) need to query and manage data in OntoCenter. The platform already exposes a complete REST API, but agents need a standardized discovery and invocation protocol.

Model Context Protocol (MCP) is emerging as the standard for agent-tool interoperability. Claude Code and Cursor support it natively. Other agents can integrate via REST API directly.

## Decision

Build an MCP Server as a separate package (`packages/mcp-server`) that wraps the OntoCenter REST API.

### Architecture

```
Claude Code / Cursor
  ↕ stdio (MCP protocol)
@omaha/mcp-server (local process on user's machine)
  ↕ HTTP (REST API calls)
OntoCenter instance (localhost or remote)
```

### Tool Exposure Strategy

All 14 internal tools are exposed via MCP, but scoped by user permissions:

| Scope | Tools | When |
|-------|-------|------|
| Query (default) | query_objects, aggregate_objects, get_ontology_schema | Always available |
| Ontology | create/update/delete_object_type, create/delete_relationship | If user has ontology:write permission |
| Data | parse_file, import_data, create_connector, test_db_connection, list_db_tables, preview_db_table | If user has data:write permission |

The MCP Server fetches user permissions on startup and only registers permitted tools.

### Authentication

Environment variables, with automatic login and token refresh:

```json
{
  "mcpServers": {
    "ontocenter": {
      "command": "npx",
      "args": ["@omaha/mcp-server"],
      "env": {
        "ONTOCENTER_URL": "http://localhost:3001",
        "ONTOCENTER_EMAIL": "admin@demo.com",
        "ONTOCENTER_PASSWORD": "admin123",
        "ONTOCENTER_TENANT": "demo"
      }
    }
  }
}
```

The server calls POST /auth/login on startup, stores the JWT, and refreshes before expiry.

### Tool Definitions

Each MCP tool maps 1:1 to a REST endpoint:

| MCP Tool | HTTP Method | Endpoint |
|----------|-------------|----------|
| query_objects | POST | /query/objects |
| aggregate_objects | POST | /query/aggregate |
| get_ontology_schema | GET | /ontology/types + /ontology/relationships |
| create_object_type | POST | /ontology/types |
| update_object_type | PUT | /ontology/types/:id |
| delete_object_type | DELETE | /ontology/types/:id |
| create_relationship | POST | /ontology/relationships |
| delete_relationship | DELETE | /ontology/relationships/:id |
| test_db_connection | POST | /connectors/test |
| create_connector | POST | /connectors |
| list_db_tables | GET | /connectors/:id/tables |
| preview_db_table | GET | /connectors/:id/tables/:name |
| parse_file | POST | /files/upload |
| import_data | POST | /import |

### Complementary: Skill File

A Claude Code skill file (`docs/integrations/claude-code-skill.md`) provides a zero-dependency fallback. Users who cannot run the MCP Server (e.g., restricted environments) can copy this file to `.claude/skills/` and Claude Code will use curl to call the REST API directly.

## Consequences

- External agents get native tool integration with OntoCenter
- MCP Server is a thin HTTP client (~200 lines for MVP), low maintenance burden
- Permission scoping reuses existing RBAC — no new auth mechanism needed
- The skill file provides immediate value before MCP Server is implemented
- Future: OpenAPI spec generation would further improve discoverability for non-MCP agents

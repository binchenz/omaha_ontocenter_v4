/**
 * Schema lint test — validates ALL registered tools have strict-mode compliant
 * JSON Schemas per DeepSeek beta endpoint requirements (Issue #137 / ADR-0047).
 *
 * Rules:
 * 1. Every `type: "object"` node must have `additionalProperties: false`
 * 2. Every `type: "object"` node must have `required` listing ALL its property keys
 */
import { AggregateObjectsTool } from '../tools/aggregate-objects.tool';
import { CreateConnectorTool } from '../tools/create-connector.tool';
import { CreateObjectTypeTool } from '../tools/create-object-type.tool';
import { CreateRelationshipTool } from '../tools/create-relationship.tool';
import { DeleteObjectTypeTool } from '../tools/delete-object-type.tool';
import { DeleteRelationshipTool } from '../tools/delete-relationship.tool';
import { ExtractAvcReportTool } from '../tools/extract-avc-report.tool';
import { GetOntologySchemaTool } from '../tools/get-ontology-schema.tool';
import { ImportDataTool } from '../tools/import-data.tool';
import { IngestDocumentTool } from '../tools/ingest-document.tool';
import { ListDbTablesTool } from '../tools/list-db-tables.tool';
import { ParseFileTool } from '../tools/parse-file.tool';
import { PreviewDbTableTool } from '../tools/preview-db-table.tool';
import { QueryObjectsTool } from '../tools/query-objects.tool';
import { SemanticSearchTool } from '../tools/semantic-search.tool';
import { TestDbConnectionTool } from '../tools/test-db-connection.tool';
import { UpdateObjectTypeTool } from '../tools/update-object-type.tool';

// Recursive validator for nested object schemas
function validateObjectNode(schema: any, path: string, errors: string[]): void {
  if (!schema || typeof schema !== 'object') return;

  if (schema.type === 'object') {
    if (schema.additionalProperties !== false) {
      errors.push(`${path}: missing additionalProperties: false`);
    }
    const propKeys = Object.keys(schema.properties ?? {});
    const required = schema.required ?? [];
    const missingRequired = propKeys.filter(k => !required.includes(k));
    if (missingRequired.length > 0) {
      errors.push(`${path}: properties not in required: [${missingRequired.join(', ')}]`);
    }
    // Recurse into each property
    for (const [key, value] of Object.entries(schema.properties ?? {})) {
      validateObjectNode(value, `${path}.properties.${key}`, errors);
    }
  }

  // Recurse into array items
  if (schema.type === 'array' && schema.items) {
    validateObjectNode(schema.items, `${path}.items`, errors);
  }

  // Recurse into anyOf
  if (Array.isArray(schema.anyOf)) {
    schema.anyOf.forEach((variant: any, i: number) => {
      validateObjectNode(variant, `${path}.anyOf[${i}]`, errors);
    });
  }
}

// Instantiate tools with null deps (we only inspect .parameters, never call .execute)
const tools = [
  new AggregateObjectsTool(null as any),
  new CreateConnectorTool(null as any),
  new CreateObjectTypeTool(null as any),
  new CreateRelationshipTool(null as any),
  new DeleteObjectTypeTool(null as any),
  new DeleteRelationshipTool(null as any),
  new ExtractAvcReportTool(null as any),
  new GetOntologySchemaTool(null as any),
  new ImportDataTool(null as any),
  new IngestDocumentTool(null as any),
  new ListDbTablesTool(null as any),
  new ParseFileTool(null as any),
  new PreviewDbTableTool(null as any),
  new QueryObjectsTool(null as any),
  new SemanticSearchTool(null as any),
  new TestDbConnectionTool(null as any),
  new UpdateObjectTypeTool(null as any),
];

describe('Strict tool schema compliance (#137)', () => {
  it('covers all 17 tools', () => {
    expect(tools.length).toBe(17);
  });

  it.each(tools.map(t => [t.name, t]))('%s has strict-compliant schema', (_name, tool) => {
    const errors: string[] = [];
    validateObjectNode(tool.parameters, tool.name, errors);
    expect(errors).toEqual([]);
  });
});

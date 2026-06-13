import { Test } from '@nestjs/testing';
import { AgentModule } from './agent.module';
import { PrismaModule } from '../../common/prisma.module';
import { PermissionModule } from '../permission/permission.module';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { OntologySdk } from '../ontology/ontology.sdk';
import { ResearchSdk } from '../research/research.sdk';
import { ConnectorSdk } from './connector/connector.sdk';
import { ConfirmationGate } from './confirmation/confirmation-gate.service';
import { ConnectorClient } from './connector/connector-client.service';
import { ImportEngine } from './sdk/import-engine.service';
import { TypeResolver } from './sdk/type-resolver.service';
import { QueryObjectsTool } from './tools/query-objects.tool';
import { GetOntologySchemaTool } from './tools/get-ontology-schema.tool';
import { ParseFileTool } from './tools/parse-file.tool';
import { CreateObjectTypeTool } from './tools/create-object-type.tool';
import { UpdateObjectTypeTool } from './tools/update-object-type.tool';
import { DeleteObjectTypeTool } from './tools/delete-object-type.tool';
import { ImportDataTool } from './tools/import-data.tool';
import { TestDbConnectionTool } from './tools/test-db-connection.tool';
import { CreateConnectorTool } from './tools/create-connector.tool';
import { ListDbTablesTool } from './tools/list-db-tables.tool';
import { PreviewDbTableTool } from './tools/preview-db-table.tool';
import { CreateRelationshipTool } from './tools/create-relationship.tool';
import { DeleteRelationshipTool } from './tools/delete-relationship.tool';
import { AGENT_TOOLS } from '../tool-registry/tool-registry.tokens';
import { ToolCollector } from '../tool-registry/tool-collector.service';
import { AgentBootstrap } from './agent.bootstrap';

describe('AgentModule (boot smoke test)', () => {
  it('AGENT_TOOLS resolves to an array aggregating tools from every module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, PermissionModule, AgentModule],
    }).compile();

    // AGENT_TOOLS must be an ARRAY (NestJS does not support Angular-style `multi: true`,
    // which silently yielded a single object — ADR-0052 fix via DiscoveryService).
    const tools = moduleRef.get<any[]>(AGENT_TOOLS);
    expect(Array.isArray(tools)).toBe(true);

    // The collector does the real aggregation (fresh discovery, order-independent).
    // The stable AGENT_TOOLS reference is filled from this at onApplicationBootstrap.
    const collected = await moduleRef.get(ToolCollector).collect();
    const names = collected.map((t) => t.name);
    // own tools + cross-module tools (action, data-import, transform-config) all present
    expect(names).toEqual(
      expect.arrayContaining([
        'query_objects',
        'create_action',
        'execute_import',
        'create_transform_config',
        'list_transform_configs',
      ]),
    );
    // no duplicates (read_file_preview is provided by two modules)
    expect(names.length).toBe(new Set(names).size);

    await moduleRef.close();
  });

  it('AgentBootstrap orphan check passes for every collected tool (no .init(): DB-free)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, PermissionModule, AgentModule],
    }).compile();

    // Run the orphan check against the REAL collected tools + skills without firing
    // .init() (which would block on pg-boss DB connect). This catches both the array
    // bug (map crash) and the landmine: every registered tool must be declared by a skill.
    const bootstrap = moduleRef.get(AgentBootstrap);
    await expect(bootstrap.onApplicationBootstrap()).resolves.toBeUndefined();

    await moduleRef.close();
  });

  it('boots and resolves all key providers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, PermissionModule, AgentModule],
    }).compile();

    expect(moduleRef.get(OrchestratorService)).toBeDefined();
    expect(moduleRef.get(OntologySdk)).toBeDefined();
    expect(moduleRef.get(ResearchSdk)).toBeDefined();
    expect(moduleRef.get(ConnectorSdk)).toBeDefined();
    expect(moduleRef.get(ConfirmationGate)).toBeDefined();
    expect(moduleRef.get(ConnectorClient)).toBeDefined();
    expect(moduleRef.get(ImportEngine)).toBeDefined();
    expect(moduleRef.get(TypeResolver)).toBeDefined();

    const toolClasses = [
      QueryObjectsTool, GetOntologySchemaTool, ParseFileTool,
      CreateObjectTypeTool, UpdateObjectTypeTool, DeleteObjectTypeTool,
      ImportDataTool, TestDbConnectionTool, CreateConnectorTool,
      ListDbTablesTool, PreviewDbTableTool, CreateRelationshipTool, DeleteRelationshipTool,
    ];
    for (const ToolClass of toolClasses) {
      expect(moduleRef.get(ToolClass)).toBeDefined();
    }

    await moduleRef.close();
  });

  it('throws on bootstrap when a registered Tool is not declared by any Skill', async () => {
    const { AgentBootstrap } = await import('./agent.bootstrap');
    const orphanTool: any = {
      name: 'orphan_tool',
      description: 'A tool no skill declares',
      parameters: {},
      requiresConfirmation: false,
      execute: async () => ({}),
    };
    const skill: any = { name: 's', description: '', tools: ['other'], systemPrompt: () => '' };

    const collector: any = { collect: async () => [orphanTool] };
    const bootstrap = new AgentBootstrap(collector, [skill]);
    await expect(bootstrap.onApplicationBootstrap()).rejects.toThrow(/orphan_tool/);
  });

  it('does not throw on bootstrap when every Tool is declared', async () => {
    const { AgentBootstrap } = await import('./agent.bootstrap');
    const tool: any = { name: 't1', description: '', parameters: {}, requiresConfirmation: false, execute: async () => ({}) };
    const skill: any = { name: 's', description: '', tools: ['t1'], systemPrompt: () => '' };

    const collector: any = { collect: async () => [tool] };
    const bootstrap = new AgentBootstrap(collector, [skill]);
    await expect(bootstrap.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});

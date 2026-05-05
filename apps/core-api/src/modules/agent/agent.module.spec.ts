import { Test } from '@nestjs/testing';
import { AgentModule } from './agent.module';
import { PrismaModule } from '../../common/prisma.module';
import { PermissionModule } from '../permission/permission.module';
import { AgentService } from './agent.service';
import { OntologySdkService } from './sdk/ontology-sdk.service';
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

describe('AgentModule (boot smoke test)', () => {
  it('boots and resolves all key providers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, PermissionModule, AgentModule],
    }).compile();

    expect(moduleRef.get(AgentService)).toBeDefined();
    expect(moduleRef.get(OntologySdkService)).toBeDefined();
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

  it('throws on init when a registered Tool is not declared by any Skill', async () => {
    const { AgentBootstrap } = await import('./agent.bootstrap');
    const orphanTool: any = {
      name: 'orphan_tool',
      description: 'A tool no skill declares',
      parameters: {},
      requiresConfirmation: false,
      execute: async () => ({}),
    };
    const skill: any = { name: 's', description: '', tools: ['other'], systemPrompt: () => '' };

    const bootstrap = new AgentBootstrap([orphanTool], [skill]);
    expect(() => bootstrap.onModuleInit()).toThrow(/orphan_tool/);
  });

  it('does not throw on init when every Tool is declared', async () => {
    const { AgentBootstrap } = await import('./agent.bootstrap');
    const tool: any = { name: 't1', description: '', parameters: {}, requiresConfirmation: false, execute: async () => ({}) };
    const skill: any = { name: 's', description: '', tools: ['t1'], systemPrompt: () => '' };

    const bootstrap = new AgentBootstrap([tool], [skill]);
    expect(() => bootstrap.onModuleInit()).not.toThrow();
  });
});

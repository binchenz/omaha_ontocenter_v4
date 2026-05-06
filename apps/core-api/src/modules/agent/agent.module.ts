import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { OntologyModule } from '../ontology/ontology.module';
import { QueryModule } from '../query/query.module';
import { AgentController } from './agent.controller';
import { FileController } from './file.controller';
import { AgentService } from './agent.service';
import { ConversationService } from './conversation/conversation.service';
import { ConfirmationGate } from './confirmation/confirmation-gate.service';
import { ConnectorClient } from './connector/connector-client.service';
import { SseAgentRunner } from './sse/sse-agent-runner.service';
import { OntologySdkService } from './sdk/ontology-sdk.service';
import { TypeResolver } from './sdk/type-resolver.service';
import { ImportEngine } from './sdk/import-engine.service';
import { FileParserService } from './tools/file-parser.service';
import { QueryObjectsTool } from './tools/query-objects.tool';
import { AggregateObjectsTool } from './tools/aggregate-objects.tool';
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
import { LLM_CLIENT } from './llm/llm-client.interface';
import { DeepSeekLlmClient } from './llm/deepseek-llm-client';
import { AgentTool } from './tools/tool.interface';
import { AgentSkill } from './skills/skill.interface';
import { QuerySkill } from './skills/query.skill';
import { DataIngestionSkill } from './skills/data-ingestion.skill';
import { OntologyDesignSkill } from './skills/ontology-design.skill';
import { AgentBootstrap } from './agent.bootstrap';
import { AGENT_TOOLS, AGENT_SKILLS } from './agent.tokens';

@Module({
  imports: [OntologyModule, QueryModule, MulterModule.register({ dest: './uploads' })],
  controllers: [AgentController, FileController],
  providers: [
    { provide: LLM_CLIENT, useClass: DeepSeekLlmClient },
    FileParserService,
    TypeResolver,
    ImportEngine,
    OntologySdkService,
    ConfirmationGate,
    ConnectorClient,
    SseAgentRunner,
    QueryObjectsTool,
    AggregateObjectsTool,
    GetOntologySchemaTool,
    ParseFileTool,
    CreateObjectTypeTool,
    UpdateObjectTypeTool,
    DeleteObjectTypeTool,
    ImportDataTool,
    TestDbConnectionTool,
    CreateConnectorTool,
    ListDbTablesTool,
    PreviewDbTableTool,
    CreateRelationshipTool,
    DeleteRelationshipTool,
    {
      provide: AGENT_TOOLS,
      useFactory: (...tools: AgentTool[]): AgentTool[] => tools,
      inject: [
        QueryObjectsTool, AggregateObjectsTool, GetOntologySchemaTool, ParseFileTool,
        CreateObjectTypeTool, UpdateObjectTypeTool, DeleteObjectTypeTool,
        ImportDataTool, TestDbConnectionTool, CreateConnectorTool,
        ListDbTablesTool, PreviewDbTableTool, CreateRelationshipTool, DeleteRelationshipTool,
      ],
    },
    {
      provide: AGENT_SKILLS,
      useFactory: (): AgentSkill[] => [new QuerySkill(), new DataIngestionSkill(), new OntologyDesignSkill()],
    },
    {
      provide: AgentService,
      useFactory: (llm: DeepSeekLlmClient, tools: AgentTool[], skills: AgentSkill[], gate: ConfirmationGate) =>
        new AgentService(llm, tools, skills, gate),
      inject: [LLM_CLIENT, AGENT_TOOLS, AGENT_SKILLS, ConfirmationGate],
    },
    ConversationService,
    AgentBootstrap,
  ],
})
export class AgentModule {}

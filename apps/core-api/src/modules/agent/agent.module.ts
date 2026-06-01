import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { CoreSdkModule } from '../sdk/core-sdk.module';
import { ConversationModule } from '../conversation/conversation.module';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { AgentController } from './agent.controller';
import { FileController } from './file.controller';
import { ConfirmationGate } from './confirmation/confirmation-gate.service';
import { SseAgentRunner } from './sse/sse-agent-runner.service';
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
import { ExtractAvcReportTool } from './tools/extract-avc-report.tool';
import { IngestDocumentTool } from './tools/ingest-document.tool';
import { LLM_CLIENT, LlmClient } from './llm/llm-client.interface';
import { DeepSeekLlmClient } from './llm/deepseek-llm-client';
import { ResilientLlmClient } from './llm/resilient-llm-client';
import { AgentTool } from './tools/tool.interface';
import { AgentSkill } from './skills/skill.interface';
import { QuerySkill } from './skills/query.skill';
import { DataIngestionSkill } from './skills/data-ingestion.skill';
import { OntologyDesignSkill } from './skills/ontology-design.skill';
import { AgentBootstrap } from './agent.bootstrap';
import { PlanSummarizer } from './plan-summarizer.service';
import { EvalsService } from './evals.service';
import { EvalsController } from './evals.controller';
import { AGENT_TOOLS, AGENT_SKILLS } from './agent.tokens';

@Module({
  imports: [CoreSdkModule, ConversationModule, MulterModule.register({ dest: './uploads' })],
  controllers: [AgentController, FileController, EvalsController],
  providers: [
    { provide: LLM_CLIENT, useFactory: () => new ResilientLlmClient(new DeepSeekLlmClient()) },
    ConfirmationGate,
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
    ExtractAvcReportTool,
    IngestDocumentTool,
    {
      provide: AGENT_TOOLS,
      useFactory: (...tools: AgentTool[]): AgentTool[] => tools,
      inject: [
        QueryObjectsTool, AggregateObjectsTool, GetOntologySchemaTool, ParseFileTool,
        CreateObjectTypeTool, UpdateObjectTypeTool, DeleteObjectTypeTool,
        ImportDataTool, TestDbConnectionTool, CreateConnectorTool,
        ListDbTablesTool, PreviewDbTableTool, CreateRelationshipTool, DeleteRelationshipTool,
        ExtractAvcReportTool, IngestDocumentTool,
      ],
    },
    {
      provide: AGENT_SKILLS,
      useFactory: (): AgentSkill[] => [new QuerySkill(), new DataIngestionSkill(), new OntologyDesignSkill()],
    },
    {
      provide: OrchestratorService,
      useFactory: (llm: LlmClient, tools: AgentTool[], skills: AgentSkill[], gate: ConfirmationGate, planSummarizer: PlanSummarizer) =>
        new OrchestratorService(llm, tools, skills, gate, planSummarizer),
      inject: [LLM_CLIENT, AGENT_TOOLS, AGENT_SKILLS, ConfirmationGate, PlanSummarizer],
    },
    PlanSummarizer,
    EvalsService,
    AgentBootstrap,
  ],
})
export class AgentModule {}

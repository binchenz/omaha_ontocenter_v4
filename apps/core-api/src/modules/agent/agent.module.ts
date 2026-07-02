import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ConversationModule } from '../conversation/conversation.module';
import { QueryModule } from '../query/query.module';
import { OntologySdkModule } from '../ontology/ontology-sdk.module';
import { ResearchModule } from '../research/research.module';
import { ConnectorSdkModule } from './connector/connector-sdk.module';
import { AgentSdkModule } from './sdk/agent-sdk.module';
import { ActionModule } from '../action/action.module';
import { DataImportModule } from '../data-import/data-import.module';
import { TransformConfigModule } from '../transform-config/transform-config.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { IntentRouter } from '../orchestrator/intent-router';
import { MetricQueryService } from '../query/metric-query.service';
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
import { SemanticSearchTool } from './tools/semantic-search.tool';
import { ReadFilePreviewTool } from './tools/read-file-preview.tool';
import { RenderChartTool } from './tools/render-chart.tool';
import { ProbeCoverageTool } from './tools/probe-coverage.tool';
import { QueryMetricTool } from './tools/query-metric.tool';
import { LLM_CLIENT, LlmClient } from './llm/llm-client.interface';
import { DeepSeekLlmClient } from './llm/deepseek-llm-client';
import { ResilientLlmClient } from './llm/resilient-llm-client';
import { AgentTool } from './tools/tool.interface';
import { AgentSkill } from './skills/skill.interface';
import { QuerySkill } from './skills/query.skill';
import { DataIngestionSkill } from './skills/data-ingestion.skill';
import { OntologyDesignSkill } from './skills/ontology-design.skill';
import { ResearchQaSkill } from './skills/research-qa.skill';
import { DataImportSkill } from './skills/data-import.skill';
import { DataPipelineSkill } from './skills/data-pipeline.skill';
import { AgentBootstrap } from './agent.bootstrap';
import { PlanSummarizer } from './plan-summarizer.service';
import { EvalsService } from './evals.service';
import { EvalsController } from './evals.controller';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { VERTICALS } from '../vertical/vertical.tokens';
import { Vertical, collectVerticalContributions } from '../vertical/vertical';
import { SALES_RECORDS_VERTICAL } from '../vertical/reference/sales-records.vertical';
import { AVC_VERTICAL } from '../vertical/avc/avc.vertical';
import { AGENT_TOOLS, AGENT_SKILLS } from '../tool-registry/tool-registry.tokens';

const AGENT_OWN_TOOLS = [
  QueryObjectsTool, AggregateObjectsTool, GetOntologySchemaTool, ParseFileTool,
  CreateObjectTypeTool, UpdateObjectTypeTool, DeleteObjectTypeTool,
  ImportDataTool, TestDbConnectionTool, CreateConnectorTool,
  ListDbTablesTool, PreviewDbTableTool, CreateRelationshipTool, DeleteRelationshipTool,
  ExtractAvcReportTool, IngestDocumentTool, SemanticSearchTool, ReadFilePreviewTool,
  RenderChartTool, ProbeCoverageTool, QueryMetricTool,
] as const;

@Module({
  imports: [
    ToolRegistryModule,
    QueryModule,
    OntologySdkModule,
    ResearchModule,
    ConnectorSdkModule,
    AgentSdkModule,
    ConversationModule,
    ActionModule,      // marks AGENT_TOOLS (CreateActionTool, ExecuteActionTool)
    DataImportModule,  // marks AGENT_TOOLS (PreviewImportFileTool, ExecuteImportTool)
    TransformConfigModule, // marks AGENT_TOOLS (CreateTransformConfigTool, ListTransformConfigsTool)
    PipelineModule,    // marks AGENT_TOOLS (ConfigurePipelineTool)
    MulterModule.register({ dest: './uploads' }),
  ],
  controllers: [AgentController, FileController, EvalsController],
  providers: [
    { provide: LLM_CLIENT, useFactory: () => new ResilientLlmClient(new DeepSeekLlmClient()) },
    ConfirmationGate,
    SseAgentRunner,
    ...AGENT_OWN_TOOLS,
    ...ToolRegistryModule.providers(...AGENT_OWN_TOOLS),
    // ADR-0062 — registered Verticals. Core ships the neutral reference vertical + the AVC vertical
    // (AVC code still lives in-repo pending #209's physical move to a private package). Core depends
    // on zero concrete verticals beyond this single wiring list — the one place verticals are named.
    { provide: VERTICALS, useValue: [SALES_RECORDS_VERTICAL, AVC_VERTICAL] as Vertical[] },
    {
      provide: AGENT_SKILLS,
      useFactory: (verticals: Vertical[]): AgentSkill[] => [
        new QuerySkill(), new DataIngestionSkill(), new OntologyDesignSkill(),
        new ResearchQaSkill(), new DataImportSkill(), new DataPipelineSkill(),
        // ADR-0062 §4 — skills contributed by registered verticals (e.g. the reference vertical's
        // sales_analysis skill) fan in here alongside the core skills.
        ...collectVerticalContributions(verticals).skills,
      ],
      inject: [VERTICALS],
    },
    {
      // ADR-0064 §5 — the fast/slow intent router. Injected into the orchestrator so a
      // simple catalogue lookup bypasses the multi-step loop. Depends on the LLM (one
      // classification call) + MetricQueryService (deterministic execute).
      provide: IntentRouter,
      useFactory: (llm: LlmClient, metricQuery: MetricQueryService) => new IntentRouter(llm, metricQuery),
      inject: [LLM_CLIENT, MetricQueryService],
    },
    {
      provide: OrchestratorService,
      useFactory: (llm: LlmClient, tools: AgentTool[], skills: AgentSkill[], gate: ConfirmationGate, planSummarizer: PlanSummarizer, intentRouter: IntentRouter) =>
        new OrchestratorService(llm, tools, skills, gate, planSummarizer, intentRouter),
      inject: [LLM_CLIENT, AGENT_TOOLS, AGENT_SKILLS, ConfirmationGate, PlanSummarizer, IntentRouter],
    },
    PlanSummarizer,
    EvalsService,
    AgentBootstrap,
  ],
})
export class AgentModule {}

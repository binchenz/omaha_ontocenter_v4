import { Module } from '@nestjs/common';
import { PrismaModule } from './common/prisma.module';
import { LoggerModule } from './common/logger.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { OntologyModule } from './modules/ontology/ontology.module';
import { ConnectorModule } from './modules/connector/connector.module';
import { MappingModule } from './modules/mapping/mapping.module';
import { PermissionModule } from './modules/permission/permission.module';
import { QueryModule } from './modules/query/query.module';
import { AgentModule } from './modules/agent/agent.module';
import { SdkModule } from './modules/sdk/sdk.module';
import { ApplyModule } from './modules/apply/apply.module';
import { DatasetModule } from './modules/dataset/dataset.module';
import { PipelineModule } from './modules/pipeline/pipeline.module';
import { HealthModule } from './modules/health/health.module';
import { ActionModule } from './modules/action/action.module';

@Module({
  imports: [PrismaModule, LoggerModule, AuthModule, TenantModule, OntologyModule, ConnectorModule, MappingModule, PermissionModule, QueryModule, AgentModule, SdkModule, ApplyModule, DatasetModule, PipelineModule, HealthModule, ActionModule],
})
export class AppModule {}

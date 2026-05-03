import { Module } from '@nestjs/common';
import { PrismaModule } from './common/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { OntologyModule } from './modules/ontology/ontology.module';
import { ConnectorModule } from './modules/connector/connector.module';
import { MappingModule } from './modules/mapping/mapping.module';
import { PermissionModule } from './modules/permission/permission.module';

@Module({
  imports: [PrismaModule, AuthModule, TenantModule, OntologyModule, ConnectorModule, MappingModule, PermissionModule],
})
export class AppModule {}

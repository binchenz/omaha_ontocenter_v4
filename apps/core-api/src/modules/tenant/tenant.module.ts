import { Module } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

@Module({
  controllers: [TenantController],
  providers: [TenantService, PrismaService],
  exports: [TenantService],
})
export class TenantModule {}

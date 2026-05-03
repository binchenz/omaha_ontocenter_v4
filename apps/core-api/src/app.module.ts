import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { TenantModule } from './modules/tenant/tenant.module';

@Module({
  imports: [AuthModule, TenantModule],
})
export class AppModule {}

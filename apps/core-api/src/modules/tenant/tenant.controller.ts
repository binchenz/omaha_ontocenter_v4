import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('tenant')
@UseGuards(JwtAuthGuard)
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  async getCurrent(@CurrentUser('tenantId') tenantId: string) {
    return this.tenantService.findById(tenantId);
  }

  @Put('settings')
  async updateSettings(
    @CurrentUser('tenantId') tenantId: string,
    @Body() settings: Record<string, unknown>,
  ) {
    return this.tenantService.updateSettings(tenantId, settings);
  }
}

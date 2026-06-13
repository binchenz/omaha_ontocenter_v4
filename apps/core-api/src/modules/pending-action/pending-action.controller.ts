import { Controller, Post, Get, Param, UseGuards } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PendingActionService } from './pending-action.service';

@Controller('actions')
@UseGuards(JwtAuthGuard)
export class PendingActionController {
  constructor(
    private readonly pendingActionService: PendingActionService,
    private readonly prisma: PrismaService,
  ) {}

  @Post(':id/confirm')
  async confirm(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('id') actionId: string,
  ) {
    await this.pendingActionService.approve(tenantId, actionId, userId);
    return { status: 'approved' };
  }

  @Post(':id/cancel')
  async cancel(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('id') actionId: string,
  ) {
    await this.pendingActionService.cancel(tenantId, actionId, userId);
    return { status: 'cancelled' };
  }

  @Get(':id/status')
  async status(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') actionId: string,
  ): Promise<{ status: string | undefined; executionResult: unknown; executionError: string | null | undefined }> {
    const action = await this.prisma.pendingAction.findUnique({ where: { id: actionId, tenantId } });
    return {
      status: action?.status,
      executionResult: action?.executionResult,
      executionError: action?.executionError,
    };
  }
}

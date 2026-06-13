import { Injectable, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService, PendingAction } from '@omaha/db';

interface ProposeDto {
  conversationId?: string;
  type: string;
  payload: any;
  summary: string;
}

@Injectable()
export class PendingActionService {
  constructor(private readonly prisma: PrismaService) {}

  async propose(tenantId: string, userId: string, dto: ProposeDto): Promise<PendingAction> {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

    return this.prisma.pendingAction.create({
      data: {
        tenantId,
        conversationId: dto.conversationId,
        type: dto.type,
        status: 'proposed',
        payload: dto.payload,
        summary: dto.summary,
        createdBy: userId,
        expiresAt,
      },
    });
  }

  async approve(tenantId: string, actionId: string, userId: string): Promise<PendingAction> {
    const action = await this.prisma.pendingAction.findUnique({
      where: { id: actionId },
    });

    if (!action || action.tenantId !== tenantId) {
      throw new NotFoundException('Action not found');
    }

    if (action.createdBy !== userId) {
      throw new ForbiddenException('Only the action creator can approve it');
    }

    if (action.expiresAt < new Date()) {
      throw new ConflictException('Action has expired');
    }

    return this.prisma.pendingAction.update({
      where: { id: actionId },
      data: {
        status: 'approved',
        approvedBy: userId,
        approvedAt: new Date(),
      },
    });
  }

  async cancel(tenantId: string, actionId: string, userId: string): Promise<PendingAction> {
    const action = await this.prisma.pendingAction.findUnique({
      where: { id: actionId },
    });

    if (!action || action.tenantId !== tenantId) {
      throw new NotFoundException('Action not found');
    }

    if (action.createdBy !== userId) {
      throw new ForbiddenException('Only the action creator can cancel it');
    }

    return this.prisma.pendingAction.update({
      where: { id: actionId },
      data: { status: 'cancelled' },
    });
  }

  async markExecuting(tenantId: string, actionId: string): Promise<PendingAction> {
    return this.prisma.pendingAction.update({
      where: { id: actionId, tenantId },
      data: { status: 'executing' },
    });
  }

  async markCompleted(tenantId: string, actionId: string, result: any): Promise<PendingAction> {
    return this.prisma.pendingAction.update({
      where: { id: actionId, tenantId },
      data: {
        status: 'completed',
        executionResult: result,
      },
    });
  }

  async markFailed(tenantId: string, actionId: string, error: string): Promise<PendingAction> {
    return this.prisma.pendingAction.update({
      where: { id: actionId, tenantId },
      data: {
        status: 'failed',
        executionError: error,
      },
    });
  }
}

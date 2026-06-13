import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@omaha/db';
import { PendingActionService } from './pending-action.service';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

describe('PendingActionService', () => {
  let service: PendingActionService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PendingActionService,
        {
          provide: PrismaService,
          useValue: {
            pendingAction: {
              create: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<PendingActionService>(PendingActionService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('propose', () => {
    it('should create a pending action with proposed status', async () => {
      const tenantId = 'tenant-1';
      const userId = 'user-1';
      const dto = {
        conversationId: 'conv-1',
        type: 'agent_import',
        payload: { fileId: 'file-1' },
        summary: 'Import file',
      };

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const mockAction = {
        id: 'action-1',
        tenantId,
        conversationId: dto.conversationId,
        type: dto.type,
        status: 'proposed',
        payload: dto.payload,
        summary: dto.summary,
        createdBy: userId,
        approvedBy: null,
        createdAt: now,
        approvedAt: null,
        expiresAt,
        executionResult: null,
        executionError: null,
      };

      (prisma.pendingAction.create as jest.Mock).mockResolvedValue(mockAction);

      const result = await service.propose(tenantId, userId, dto);

      expect(result).toEqual(mockAction);
      expect(prisma.pendingAction.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          conversationId: dto.conversationId,
          type: dto.type,
          status: 'proposed',
          payload: dto.payload,
          summary: dto.summary,
          createdBy: userId,
          expiresAt: expect.any(Date),
        },
      });
    });
  });

  describe('approve', () => {
    it('should approve a pending action and transition to approved status', async () => {
      const tenantId = 'tenant-1';
      const userId = 'user-1';
      const actionId = 'action-1';

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const existingAction = {
        id: actionId,
        tenantId,
        status: 'proposed',
        createdBy: userId,
        expiresAt,
      };

      const updatedAction = {
        ...existingAction,
        status: 'approved',
        approvedBy: userId,
        approvedAt: now,
      };

      (prisma.pendingAction.findUnique as jest.Mock).mockResolvedValue(existingAction);
      (prisma.pendingAction.update as jest.Mock).mockResolvedValue(updatedAction);

      const result = await service.approve(tenantId, actionId, userId);

      expect(result).toEqual(updatedAction);
      expect(prisma.pendingAction.update).toHaveBeenCalledWith({
        where: { id: actionId },
        data: {
          status: 'approved',
          approvedBy: userId,
          approvedAt: expect.any(Date),
        },
      });
    });

    it('should throw NotFoundException if action does not exist', async () => {
      const tenantId = 'tenant-1';
      const userId = 'user-1';
      const actionId = 'nonexistent';

      (prisma.pendingAction.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.approve(tenantId, actionId, userId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user is not the creator', async () => {
      const tenantId = 'tenant-1';
      const userId = 'user-1';
      const otherUserId = 'user-2';
      const actionId = 'action-1';

      const existingAction = {
        id: actionId,
        tenantId,
        status: 'proposed',
        createdBy: otherUserId,
        expiresAt: new Date(Date.now() + 1000),
      };

      (prisma.pendingAction.findUnique as jest.Mock).mockResolvedValue(existingAction);

      await expect(service.approve(tenantId, actionId, userId)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ConflictException if action is expired', async () => {
      const tenantId = 'tenant-1';
      const userId = 'user-1';
      const actionId = 'action-1';

      const expiredAction = {
        id: actionId,
        tenantId,
        status: 'proposed',
        createdBy: userId,
        expiresAt: new Date(Date.now() - 1000), // expired
      };

      (prisma.pendingAction.findUnique as jest.Mock).mockResolvedValue(expiredAction);

      await expect(service.approve(tenantId, actionId, userId)).rejects.toThrow(ConflictException);
    });
  });

  describe('cancel', () => {
    it('should cancel a pending action', async () => {
      const tenantId = 'tenant-1';
      const userId = 'user-1';
      const actionId = 'action-1';

      const existingAction = {
        id: actionId,
        tenantId,
        status: 'proposed',
        createdBy: userId,
      };

      const cancelledAction = {
        ...existingAction,
        status: 'cancelled',
      };

      (prisma.pendingAction.findUnique as jest.Mock).mockResolvedValue(existingAction);
      (prisma.pendingAction.update as jest.Mock).mockResolvedValue(cancelledAction);

      const result = await service.cancel(tenantId, actionId, userId);

      expect(result).toEqual(cancelledAction);
      expect(prisma.pendingAction.update).toHaveBeenCalledWith({
        where: { id: actionId },
        data: { status: 'cancelled' },
      });
    });
  });

  describe('markExecuting', () => {
    it('should mark action as executing', async () => {
      const tenantId = 'tenant-1';
      const actionId = 'action-1';

      const executingAction = {
        id: actionId,
        tenantId,
        status: 'executing',
      };

      (prisma.pendingAction.update as jest.Mock).mockResolvedValue(executingAction);

      const result = await service.markExecuting(tenantId, actionId);

      expect(result).toEqual(executingAction);
      expect(prisma.pendingAction.update).toHaveBeenCalledWith({
        where: { id: actionId, tenantId },
        data: { status: 'executing' },
      });
    });
  });

  describe('markCompleted', () => {
    it('should mark action as completed with result', async () => {
      const tenantId = 'tenant-1';
      const actionId = 'action-1';
      const result = { rowsImported: 50 };

      const completedAction = {
        id: actionId,
        tenantId,
        status: 'completed',
        executionResult: result,
      };

      (prisma.pendingAction.update as jest.Mock).mockResolvedValue(completedAction);

      const outcome = await service.markCompleted(tenantId, actionId, result);

      expect(outcome).toEqual(completedAction);
      expect(prisma.pendingAction.update).toHaveBeenCalledWith({
        where: { id: actionId, tenantId },
        data: {
          status: 'completed',
          executionResult: result,
        },
      });
    });
  });

  describe('markFailed', () => {
    it('should mark action as failed with error', async () => {
      const tenantId = 'tenant-1';
      const actionId = 'action-1';
      const error = 'Import failed: invalid data';

      const failedAction = {
        id: actionId,
        tenantId,
        status: 'failed',
        executionError: error,
      };

      (prisma.pendingAction.update as jest.Mock).mockResolvedValue(failedAction);

      const result = await service.markFailed(tenantId, actionId, error);

      expect(result).toEqual(failedAction);
      expect(prisma.pendingAction.update).toHaveBeenCalledWith({
        where: { id: actionId, tenantId },
        data: {
          status: 'failed',
          executionError: error,
        },
      });
    });
  });
});

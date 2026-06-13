import { Test } from '@nestjs/testing';
import { PendingActionController } from './pending-action.controller';
import { PendingActionService } from './pending-action.service';
import { PrismaService } from '@omaha/db';

const mockService = { approve: jest.fn(), cancel: jest.fn() };
const mockPrisma = { pendingAction: { findUnique: jest.fn() } };

describe('PendingActionController', () => {
  let controller: PendingActionController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [PendingActionController],
      providers: [
        { provide: PendingActionService, useValue: mockService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    controller = module.get(PendingActionController);
  });

  it('confirm calls approve and returns approved', async () => {
    mockService.approve.mockResolvedValue({});
    const result = await controller.confirm('t1', 'u1', 'a1');
    expect(mockService.approve).toHaveBeenCalledWith('t1', 'a1', 'u1');
    expect(result).toEqual({ status: 'approved' });
  });

  it('cancel calls cancel and returns cancelled', async () => {
    mockService.cancel.mockResolvedValue({});
    const result = await controller.cancel('t1', 'u1', 'a1');
    expect(mockService.cancel).toHaveBeenCalledWith('t1', 'a1', 'u1');
    expect(result).toEqual({ status: 'cancelled' });
  });

  it('status returns action fields', async () => {
    mockPrisma.pendingAction.findUnique.mockResolvedValue({
      status: 'completed',
      executionResult: { rows: 3 },
      executionError: null,
    });
    const result = await controller.status('t1', 'a1');
    expect(mockPrisma.pendingAction.findUnique).toHaveBeenCalledWith({ where: { id: 'a1', tenantId: 't1' } });
    expect(result).toEqual({ status: 'completed', executionResult: { rows: 3 }, executionError: null });
  });
});

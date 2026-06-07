import { ActionExecutor, ActionEffect, ActionParam } from '../action-executor.service';

describe('ActionExecutor', () => {
  let executor: ActionExecutor;
  let mockPrisma: any;
  let mockApplyService: any;

  const tenantId = 'tenant-1';
  const userId = 'user-1';
  const objectId = 'obj-1';

  beforeEach(() => {
    mockPrisma = {
      actionDefinition: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      objectInstance: {
        findUnique: jest.fn(),
      },
      actionRun: {
        create: jest.fn(),
      },
    };
    mockApplyService = {
      apply: jest.fn().mockResolvedValue({ applied: 1, created: [] }),
    };
    executor = new ActionExecutor(mockPrisma, mockApplyService);
  });

  describe('preview', () => {
    it('returns field change preview for set_field effect', async () => {
      const effects: ActionEffect[] = [
        { type: 'set_field', field: 'status', value: '已跟进' },
      ];
      mockPrisma.actionDefinition.findFirst.mockResolvedValue({
        id: 'def-1',
        name: 'mark_followed_up',
        objectType: 'market_metric',
        parameters: [],
        precondition: null,
        effects,
      });
      mockPrisma.objectInstance.findUnique.mockResolvedValue({
        id: objectId,
        tenantId,
        objectType: 'market_metric',
        properties: { status: '待跟进', brand: '小米' },
        relationships: {},
        deletedAt: null,
      });

      const result = await executor.preview(tenantId, 'mark_followed_up', objectId, {});

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unexpected');
      expect(result.changes).toEqual([
        { type: 'set_field', field: 'status', from: '待跟进', to: '已跟进' },
      ]);
    });

    it('returns error when action does not exist', async () => {
      mockPrisma.actionDefinition.findFirst.mockResolvedValue(null);

      const result = await executor.preview(tenantId, 'nonexistent', objectId, {});

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unexpected');
      expect(result.error).toContain('不存在');
    });

    it('returns error when object type mismatches', async () => {
      mockPrisma.actionDefinition.findFirst.mockResolvedValue({
        id: 'def-1',
        name: 'mark_followed_up',
        objectType: 'market_metric',
        parameters: [],
        precondition: null,
        effects: [{ type: 'set_field', field: 'status', value: '已跟进' }],
      });
      mockPrisma.objectInstance.findUnique.mockResolvedValue({
        id: objectId,
        tenantId,
        objectType: 'customer',
        properties: {},
        relationships: {},
        deletedAt: null,
      });

      const result = await executor.preview(tenantId, 'mark_followed_up', objectId, {});

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unexpected');
      expect(result.error).toContain('market_metric');
    });
  });

  describe('execute', () => {
    it('applies set_field effect via ApplyService and creates ActionRun', async () => {
      const effects: ActionEffect[] = [
        { type: 'set_field', field: 'status', value: '已跟进' },
      ];
      const actionDef = {
        id: 'def-1',
        name: 'mark_followed_up',
        objectType: 'market_metric',
        parameters: [],
        precondition: null,
        effects,
      };
      const instance = {
        id: objectId,
        tenantId,
        objectType: 'market_metric',
        properties: { status: '待跟进', brand: '小米' },
        relationships: {},
        deletedAt: null,
      };
      mockPrisma.actionDefinition.findFirst.mockResolvedValue(actionDef);
      mockPrisma.objectInstance.findUnique.mockResolvedValue(instance);
      mockPrisma.actionRun.create.mockResolvedValue({ id: 'run-1' });

      const result = await executor.execute(tenantId, userId, 'mark_followed_up', objectId, {});

      expect(result.ok).toBe(true);
      expect(mockApplyService.apply).toHaveBeenCalledWith(
        [{ op: 'update', objectId, properties: { status: '已跟进', brand: '小米' } }],
        { tenantId, userId },
      );
      expect(mockPrisma.actionRun.create).toHaveBeenCalled();
    });

    it('resolves fromParam values in effects', async () => {
      const effects: ActionEffect[] = [
        { type: 'set_field', field: 'assignee', value: { fromParam: 'person' } },
      ];
      mockPrisma.actionDefinition.findFirst.mockResolvedValue({
        id: 'def-2',
        name: 'assign',
        objectType: 'task',
        parameters: [{ name: 'person', type: 'string', label: '负责人', required: true }],
        precondition: null,
        effects,
      });
      mockPrisma.objectInstance.findUnique.mockResolvedValue({
        id: objectId,
        tenantId,
        objectType: 'task',
        properties: { assignee: null, title: '跟进' },
        relationships: {},
        deletedAt: null,
      });
      mockPrisma.actionRun.create.mockResolvedValue({ id: 'run-2' });

      const result = await executor.execute(tenantId, userId, 'assign', objectId, { person: '张三' });

      expect(result.ok).toBe(true);
      expect(mockApplyService.apply).toHaveBeenCalledWith(
        [{ op: 'update', objectId, properties: { assignee: '张三', title: '跟进' } }],
        { tenantId, userId },
      );
    });
  });

  describe('precondition enforcement', () => {
    it('rejects execution when precondition fails', async () => {
      mockPrisma.actionDefinition.findFirst.mockResolvedValue({
        id: 'def-1',
        name: 'mark_followed_up',
        objectType: 'market_metric',
        parameters: [],
        precondition: "status = '待跟进'",
        effects: [{ type: 'set_field', field: 'status', value: '已跟进' }],
      });
      mockPrisma.objectInstance.findUnique.mockResolvedValue({
        id: objectId,
        tenantId,
        objectType: 'market_metric',
        properties: { status: '已完成', brand: '小米' },
        relationships: {},
        deletedAt: null,
      });

      const result = await executor.preview(tenantId, 'mark_followed_up', objectId, {});

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unexpected');
      expect(result.error).toContain('status');
      expect(result.error).toContain('已完成');
    });

    it('allows execution when precondition passes', async () => {
      mockPrisma.actionDefinition.findFirst.mockResolvedValue({
        id: 'def-1',
        name: 'mark_followed_up',
        objectType: 'market_metric',
        parameters: [],
        precondition: "status = '待跟进'",
        effects: [{ type: 'set_field', field: 'status', value: '已跟进' }],
      });
      mockPrisma.objectInstance.findUnique.mockResolvedValue({
        id: objectId,
        tenantId,
        objectType: 'market_metric',
        properties: { status: '待跟进', brand: '小米' },
        relationships: {},
        deletedAt: null,
      });

      const result = await executor.preview(tenantId, 'mark_followed_up', objectId, {});

      expect(result.ok).toBe(true);
    });
  });

  describe('relationship and create_object effects', () => {
    it('builds link edit for create_relationship effect with objectRef param', async () => {
      mockPrisma.actionDefinition.findFirst.mockResolvedValue({
        id: 'def-3',
        name: 'assign_to_rep',
        objectType: 'market_metric',
        parameters: [{ name: 'rep', type: 'objectRef', label: '销售', required: true, objectTypeName: 'sales_rep' }],
        precondition: null,
        effects: [{ type: 'create_relationship', relationship: 'assigned_to', targetParam: 'rep' }],
      });
      // target metric instance
      mockPrisma.objectInstance.findUnique
        .mockResolvedValueOnce({
          id: objectId, tenantId, objectType: 'market_metric',
          properties: { brand: '小米' }, relationships: {}, deletedAt: null,
        })
        // objectRef validation lookup for the rep
        .mockResolvedValueOnce({
          id: 'rep-1', tenantId, objectType: 'sales_rep',
          properties: { name: '张三' }, relationships: {}, deletedAt: null,
        });
      mockPrisma.actionRun.create.mockResolvedValue({ id: 'run-3' });

      const result = await executor.execute(tenantId, userId, 'assign_to_rep', objectId, { rep: 'rep-1' });

      expect(result.ok).toBe(true);
      expect(mockApplyService.apply).toHaveBeenCalledWith(
        [{ op: 'link', from: objectId, to: 'rep-1', linkType: 'assigned_to' }],
        { tenantId, userId },
      );
    });

    it('builds unlink edit for delete_relationship effect', async () => {
      mockPrisma.actionDefinition.findFirst.mockResolvedValue({
        id: 'def-4',
        name: 'unassign',
        objectType: 'market_metric',
        parameters: [{ name: 'rep', type: 'objectRef', label: '销售', required: true, objectTypeName: 'sales_rep' }],
        precondition: null,
        effects: [{ type: 'delete_relationship', relationship: 'assigned_to', targetParam: 'rep' }],
      });
      mockPrisma.objectInstance.findUnique
        .mockResolvedValueOnce({
          id: objectId, tenantId, objectType: 'market_metric',
          properties: {}, relationships: { assigned_to: 'rep-1' }, deletedAt: null,
        })
        .mockResolvedValueOnce({
          id: 'rep-1', tenantId, objectType: 'sales_rep',
          properties: {}, relationships: {}, deletedAt: null,
        });
      mockPrisma.actionRun.create.mockResolvedValue({ id: 'run-4' });

      const result = await executor.execute(tenantId, userId, 'unassign', objectId, { rep: 'rep-1' });

      expect(result.ok).toBe(true);
      expect(mockApplyService.apply).toHaveBeenCalledWith(
        [{ op: 'unlink', from: objectId, to: 'rep-1', linkType: 'assigned_to' }],
        { tenantId, userId },
      );
    });

    it('builds create edit for create_object effect with fromParam fields', async () => {
      mockPrisma.actionDefinition.findFirst.mockResolvedValue({
        id: 'def-5',
        name: 'create_followup',
        objectType: 'market_metric',
        parameters: [{ name: 'note', type: 'string', label: '备注', required: true }],
        precondition: null,
        effects: [{
          type: 'create_object',
          objectType: 'follow_up_task',
          fields: { title: { fromParam: 'note' }, status: '待处理' },
        }],
      });
      mockPrisma.objectInstance.findUnique.mockResolvedValue({
        id: objectId, tenantId, objectType: 'market_metric',
        properties: { brand: '小米' }, relationships: {}, deletedAt: null,
      });
      mockPrisma.actionRun.create.mockResolvedValue({ id: 'run-5' });

      const result = await executor.execute(tenantId, userId, 'create_followup', objectId, { note: '跟进小米新品' });

      expect(result.ok).toBe(true);
      expect(mockApplyService.apply).toHaveBeenCalledWith(
        [{ op: 'create', objectType: 'follow_up_task', properties: { title: '跟进小米新品', status: '待处理' } }],
        { tenantId, userId },
      );
    });

    it('rejects when objectRef target does not exist', async () => {
      mockPrisma.actionDefinition.findFirst.mockResolvedValue({
        id: 'def-3',
        name: 'assign_to_rep',
        objectType: 'market_metric',
        parameters: [{ name: 'rep', type: 'objectRef', label: '销售', required: true, objectTypeName: 'sales_rep' }],
        precondition: null,
        effects: [{ type: 'create_relationship', relationship: 'assigned_to', targetParam: 'rep' }],
      });
      mockPrisma.objectInstance.findUnique
        .mockResolvedValueOnce({
          id: objectId, tenantId, objectType: 'market_metric',
          properties: {}, relationships: {}, deletedAt: null,
        })
        .mockResolvedValueOnce(null); // rep not found

      const result = await executor.preview(tenantId, 'assign_to_rep', objectId, { rep: 'rep-missing' });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unexpected');
      expect(result.error).toContain('rep-missing');
    });
  });
});

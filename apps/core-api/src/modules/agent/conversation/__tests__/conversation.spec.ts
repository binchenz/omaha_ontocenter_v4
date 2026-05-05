import { ConversationService } from '../conversation.service';

describe('ConversationService', () => {
  const mockPrisma: any = {
    conversation: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    conversationTurn: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  let service: ConversationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ConversationService(mockPrisma);
  });

  it('rejects conversationId belonging to a different tenant', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue(null);
    mockPrisma.conversation.create.mockResolvedValue({ id: 'new-conv', userId: 'user-1', tenantId: 'tenant-1' });

    const result = await service.getOrCreate('user-1', 'tenant-1', 'foreign-conv-id');

    expect(mockPrisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign-conv-id', tenantId: 'tenant-1', userId: 'user-1' },
    });
    expect(result.id).toBe('new-conv');
  });

  it('returns existing conversation when tenant and user match', async () => {
    mockPrisma.conversation.findFirst.mockResolvedValue({ id: 'existing', userId: 'user-1', tenantId: 'tenant-1' });

    const result = await service.getOrCreate('user-1', 'tenant-1', 'existing');

    expect(result.id).toBe('existing');
    expect(mockPrisma.conversation.create).not.toHaveBeenCalled();
  });

  describe('buildLlmHistory', () => {
    it('reconstructs tool_calls on assistant messages and tool role messages', async () => {
      mockPrisma.conversationTurn.findMany.mockResolvedValue([
        { role: 'user', content: '找出A级客户', toolCalls: null, toolResults: null },
        {
          role: 'assistant',
          content: null,
          toolCalls: [{ id: 'call-1', name: 'query_objects', args: { objectType: 'Customer' } }],
          toolResults: [{ id: 'call-1', name: 'query_objects', data: { data: [], meta: { total: 0 } } }],
        },
        { role: 'assistant', content: '没有找到A级客户。', toolCalls: null, toolResults: null },
      ]);

      const history = await service.buildLlmHistory('conv-1');

      expect(history).toHaveLength(4);
      // User message
      expect(history[0]).toEqual({ role: 'user', content: '找出A级客户' });
      // Assistant with tool_calls
      expect(history[1].role).toBe('assistant');
      expect(history[1].content).toBeNull();
      expect(history[1].tool_calls).toEqual([{
        id: 'call-1',
        type: 'function',
        function: { name: 'query_objects', arguments: JSON.stringify({ objectType: 'Customer' }) },
      }]);
      // Tool result
      expect(history[2].role).toBe('tool');
      expect(history[2].tool_call_id).toBe('call-1');
      // Final text
      expect(history[3]).toEqual({ role: 'assistant', content: '没有找到A级客户。' });
    });

    it('handles turns with no tool calls as plain messages', async () => {
      mockPrisma.conversationTurn.findMany.mockResolvedValue([
        { role: 'user', content: '你好', toolCalls: null, toolResults: null },
        { role: 'assistant', content: '你好！有什么可以帮你的？', toolCalls: null, toolResults: null },
      ]);

      const history = await service.buildLlmHistory('conv-1');

      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({ role: 'user', content: '你好' });
      expect(history[1]).toEqual({ role: 'assistant', content: '你好！有什么可以帮你的？' });
    });
  });
});

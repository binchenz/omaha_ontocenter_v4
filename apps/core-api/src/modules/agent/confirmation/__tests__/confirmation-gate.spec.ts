import { ConfirmationGate, PendingConfirmation } from '../confirmation-gate.service';

describe('ConfirmationGate', () => {
  const store = new Map<string, PendingConfirmation>();
  let gate: ConfirmationGate;

  beforeEach(() => {
    store.clear();
    gate = new ConfirmationGate(store);
  });

  it('suspend stores pending state keyed by conversationId', async () => {
    await gate.suspend('conv-1', {
      toolName: 'create_connector',
      toolCallId: 'call-1',
      args: { name: 'prod-db', type: 'postgresql' },
      messages: [{ role: 'user', content: 'connect my db' }],
    });

    expect(store.has('conv-1')).toBe(true);
    const pending = store.get('conv-1')!;
    expect(pending.toolName).toBe('create_connector');
    expect(pending.toolCallId).toBe('call-1');
  });

  it('resolve returns pending state and removes it from store', async () => {
    await gate.suspend('conv-1', {
      toolName: 'delete_object_type',
      toolCallId: 'call-2',
      args: { objectTypeName: 'Customer' },
      messages: [{ role: 'user', content: 'delete Customer' }],
    });

    const pending = await gate.resolve('conv-1');
    expect(pending).not.toBeNull();
    expect(pending!.toolName).toBe('delete_object_type');
    expect(store.has('conv-1')).toBe(false);
  });

  it('resolve returns null when no pending confirmation exists', async () => {
    const pending = await gate.resolve('nonexistent');
    expect(pending).toBeNull();
  });

  it('suspend overwrites previous pending for same conversationId', async () => {
    await gate.suspend('conv-1', {
      toolName: 'first_tool',
      toolCallId: 'call-1',
      args: {},
      messages: [],
    });
    await gate.suspend('conv-1', {
      toolName: 'second_tool',
      toolCallId: 'call-2',
      args: {},
      messages: [],
    });

    const pending = store.get('conv-1')!;
    expect(pending.toolName).toBe('second_tool');
  });
});

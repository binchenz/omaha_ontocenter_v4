import { ConfirmationGate } from '../confirmation-gate.service';

describe('ConfirmationGate', () => {
  let gate: ConfirmationGate;

  beforeEach(() => {
    gate = new ConfirmationGate();
  });

  it('resolve returns the pending state previously suspended', async () => {
    await gate.suspend('conv-1', {
      toolName: 'create_connector',
      toolCallId: 'call-1',
      args: { name: 'prod-db', type: 'postgresql' },
      messages: [{ role: 'user', content: 'connect my db' }],
    });

    const pending = await gate.resolve('conv-1');
    expect(pending).not.toBeNull();
    expect(pending!.toolName).toBe('create_connector');
    expect(pending!.toolCallId).toBe('call-1');
  });

  it('resolve removes the pending state — second resolve returns null', async () => {
    await gate.suspend('conv-1', {
      toolName: 'delete_object_type',
      toolCallId: 'call-2',
      args: { objectTypeName: 'Customer' },
      messages: [{ role: 'user', content: 'delete Customer' }],
    });

    const first = await gate.resolve('conv-1');
    expect(first).not.toBeNull();

    const second = await gate.resolve('conv-1');
    expect(second).toBeNull();
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

    const pending = await gate.resolve('conv-1');
    expect(pending!.toolName).toBe('second_tool');
  });
});

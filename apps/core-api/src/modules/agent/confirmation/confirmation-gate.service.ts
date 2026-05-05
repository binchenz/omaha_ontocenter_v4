import { Injectable } from '@nestjs/common';
import { LlmMessage } from '../llm/llm-client.interface';

export interface PendingConfirmation {
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  messages: LlmMessage[];
}

@Injectable()
export class ConfirmationGate {
  constructor(private readonly store: Map<string, PendingConfirmation> = new Map()) {}

  async suspend(conversationId: string, pending: PendingConfirmation): Promise<void> {
    this.store.set(conversationId, pending);
  }

  async resolve(conversationId: string): Promise<PendingConfirmation | null> {
    const pending = this.store.get(conversationId) ?? null;
    if (pending) this.store.delete(conversationId);
    return pending;
  }
}

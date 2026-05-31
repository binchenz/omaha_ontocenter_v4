import { Injectable } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { LlmMessage } from '../agent/llm/llm-client.interface';
import { toAssistantToolCallMsg, toToolResultMsg } from '../agent/llm/llm-message-mapping';

@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate(userId: string, tenantId: string, conversationId?: string, surface?: string) {
    if (conversationId) {
      const existing = await this.prisma.conversation.findFirst({
        where: { id: conversationId, tenantId, userId },
      });
      // Surface is fixed at creation (ADR-0041 §3): a later message carrying a
      // different surface never mutates an existing Conversation's surface.
      if (existing) return existing;
    }
    return this.prisma.conversation.create({ data: { userId, tenantId, surface: surface ?? null } });
  }

  async addTurn(conversationId: string, turn: {
    role: string;
    content?: string | null;
    toolCalls?: unknown;
    toolResults?: unknown;
  }): Promise<void> {
    await this.prisma.conversationTurn.create({
      data: {
        conversationId,
        role: turn.role,
        content: turn.content ?? null,
        toolCalls: turn.toolCalls as any ?? undefined,
        toolResults: turn.toolResults as any ?? undefined,
      },
    });
  }

  async getHistory(conversationId: string, limit = 20): Promise<Array<{ role: string; content: string | null; toolCalls: unknown; toolResults: unknown }>> {
    return this.prisma.conversationTurn.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async listByUser(userId: string, tenantId: string): Promise<Array<{ id: string; title: string; surface: string | null; updatedAt: Date }>> {
    const conversations = await this.prisma.conversation.findMany({
      where: { userId, tenantId },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      include: { turns: { take: 1, orderBy: { createdAt: 'asc' } } },
    });
    return conversations.map(c => ({
      id: c.id,
      title: c.title ?? c.turns[0]?.content?.slice(0, 20) ?? '新对话',
      surface: c.surface,
      updatedAt: c.updatedAt,
    }));
  }

  async buildLlmHistory(conversationId: string, limit = 20): Promise<LlmMessage[]> {
    const turns = await this.getHistory(conversationId, limit);
    const messages: LlmMessage[] = [];

    for (const turn of turns) {
      if (turn.toolCalls && Array.isArray(turn.toolCalls) && (turn.toolCalls as any[]).length > 0) {
        const rawCalls = turn.toolCalls as Array<{ id?: string; name: string; args: unknown }>;
        const rawResults = (Array.isArray(turn.toolResults) ? turn.toolResults : []) as Array<{ id?: string; name: string; data: unknown }>;

        // Backfill ids for legacy turns persisted before tool-call ids existed,
        // then pair calls with results positionally — both are persistence
        // concerns that stay here, on the replay side.
        const callsWithIds = rawCalls.map((tc, idx) => ({
          id: tc.id ?? `legacy_${idx}`,
          name: tc.name,
          args: tc.args,
        }));

        messages.push(toAssistantToolCallMsg(callsWithIds));

        for (let i = 0; i < callsWithIds.length; i++) {
          messages.push(toToolResultMsg(callsWithIds[i].id, rawResults[i]?.data ?? null));
        }
      } else {
        messages.push({
          role: turn.role as LlmMessage['role'],
          content: turn.content,
        });
      }
    }

    return messages;
  }
}

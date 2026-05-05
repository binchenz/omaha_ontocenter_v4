import { Injectable } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { LlmMessage } from '../llm/llm-client.interface';

@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate(userId: string, tenantId: string, conversationId?: string) {
    if (conversationId) {
      const existing = await this.prisma.conversation.findFirst({
        where: { id: conversationId, tenantId, userId },
      });
      if (existing) return existing;
    }

    return this.prisma.conversation.create({
      data: { userId, tenantId },
    });
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

  async listByUser(userId: string, tenantId: string): Promise<Array<{ id: string; title: string; updatedAt: Date }>> {
    const conversations = await this.prisma.conversation.findMany({
      where: { userId, tenantId },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      include: { turns: { take: 1, orderBy: { createdAt: 'asc' } } },
    });

    return conversations.map(c => ({
      id: c.id,
      title: c.title ?? c.turns[0]?.content?.slice(0, 20) ?? '新对话',
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

        const callsWithIds = rawCalls.map((tc, idx) => ({
          id: tc.id ?? `legacy_${idx}`,
          name: tc.name,
          args: tc.args,
        }));

        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: callsWithIds.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        });

        for (let i = 0; i < callsWithIds.length; i++) {
          const matchingResult = rawResults[i];
          messages.push({
            role: 'tool',
            content: JSON.stringify(matchingResult?.data ?? null),
            tool_call_id: callsWithIds[i].id,
          });
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

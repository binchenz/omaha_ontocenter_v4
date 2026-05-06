import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import { AgentEvent } from '../agent.service';
import { ConversationService } from '../conversation/conversation.service';

@Injectable()
export class SseAgentRunner {
  constructor(private readonly conversationService: ConversationService) {}

  async stream(
    res: Response,
    generator: AsyncGenerator<AgentEvent>,
    conversationId: string,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const toolCalls: unknown[] = [];
    const toolResults: unknown[] = [];
    let textContent = '';

    try {
      for await (const event of generator) {
        if (event.type === 'done') {
          (event as any).conversationId = conversationId;
        }
        if (event.type === 'tool_call') {
          toolCalls.push({ id: event.id, name: event.name, args: event.args });
        }
        if (event.type === 'tool_result') {
          toolResults.push({ id: event.id, name: event.name, data: event.data });
        }
        if (event.type === 'text') {
          textContent = event.content;
        }
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }

      if (textContent || toolCalls.length) {
        await this.conversationService.addTurn(conversationId, {
          role: 'assistant',
          content: textContent || null,
          toolCalls: toolCalls.length ? toolCalls : undefined,
          toolResults: toolResults.length ? toolResults : undefined,
        });
      }
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err?.message ?? 'agent stream failed' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done', conversationId })}\n\n`);
    } finally {
      res.end();
    }
  }
}

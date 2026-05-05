import { Controller, Post, Get, Body, Res, Param, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '@omaha/shared-types';
import { AgentService } from './agent.service';
import { ConversationService } from './conversation/conversation.service';
import { ChatDto } from './dto/chat.dto';

@Controller('agent')
@UseGuards(JwtAuthGuard)
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly conversationService: ConversationService,
  ) {}

  @Get('conversations')
  async listConversations(@CurrentUser() user: CurrentUserType) {
    return this.conversationService.listByUser(user.id, user.tenantId);
  }

  @Get('conversations/:id/turns')
  async getConversationTurns(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    return this.conversationService.getHistory(id);
  }

  @Post('confirm')
  async confirm(
    @CurrentUser() user: CurrentUserType,
    @Body() body: { conversationId: string; confirmed: boolean; comment?: string },
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const toolCalls: unknown[] = [];
    const toolResults: unknown[] = [];
    let textContent = '';

    try {
      for await (const event of this.agentService.resume({
        user,
        conversationId: body.conversationId,
        confirmed: body.confirmed,
        comment: body.comment,
      })) {
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
        await this.conversationService.addTurn(body.conversationId, {
          role: 'assistant',
          content: textContent || null,
          toolCalls: toolCalls.length ? toolCalls : undefined,
          toolResults: toolResults.length ? toolResults : undefined,
        });
      }
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    }

    res.end();
  }

  @Post('chat')
  async chat(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: ChatDto,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const conversation = await this.conversationService.getOrCreate(
      user.id, user.tenantId, dto.conversationId,
    );

    const history = await this.conversationService.buildLlmHistory(conversation.id);

    await this.conversationService.addTurn(conversation.id, {
      role: 'user',
      content: dto.message,
    });

    const toolCalls: unknown[] = [];
    const toolResults: unknown[] = [];
    let textContent = '';

    try {
      for await (const event of this.agentService.run({
        user,
        message: dto.message,
        conversationId: conversation.id,
        history,
        fileId: dto.fileId,
      })) {
        if (event.type === 'done') {
          event.conversationId = conversation.id;
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

      await this.conversationService.addTurn(conversation.id, {
        role: 'assistant',
        content: textContent || null,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        toolResults: toolResults.length ? toolResults : undefined,
      });
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    }

    res.end();
  }
}

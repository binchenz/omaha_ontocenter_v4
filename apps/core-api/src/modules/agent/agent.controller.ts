import { Controller, Post, Get, Body, Res, Param, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '@omaha/shared-types';
import { AgentService } from './agent.service';
import { ConversationService } from './conversation/conversation.service';
import { SseAgentRunner } from './sse/sse-agent-runner.service';
import { ChatDto } from './dto/chat.dto';

@Controller('agent')
@UseGuards(JwtAuthGuard)
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly conversationService: ConversationService,
    private readonly sseRunner: SseAgentRunner,
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
    await this.sseRunner.stream(
      res,
      this.agentService.resume({
        user,
        conversationId: body.conversationId,
        confirmed: body.confirmed,
        comment: body.comment,
      }),
      body.conversationId,
    );
  }

  @Post('chat')
  async chat(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: ChatDto,
    @Res() res: Response,
  ) {
    const conversation = await this.conversationService.getOrCreate(
      user.id, user.tenantId, dto.conversationId,
    );

    const history = await this.conversationService.buildLlmHistory(conversation.id);

    await this.conversationService.addTurn(conversation.id, {
      role: 'user',
      content: dto.message,
    });

    await this.sseRunner.stream(
      res,
      this.agentService.run({
        user,
        message: dto.message,
        conversationId: conversation.id,
        history,
        fileId: dto.fileId,
      }),
      conversation.id,
    );
  }
}

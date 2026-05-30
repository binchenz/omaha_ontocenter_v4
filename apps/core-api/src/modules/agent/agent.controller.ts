import { Controller, Post, Get, Body, Res, Param, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '@omaha/shared-types';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { ConversationService } from '../conversation/conversation.service';
import { CoreSdkService } from '../sdk/core-sdk.service';
import { SseAgentRunner } from './sse/sse-agent-runner.service';
import { PlanSummarizer } from './plan-summarizer.service';
import { ChatDto } from './dto/chat.dto';

@Controller('agent')
@UseGuards(JwtAuthGuard)
export class AgentController {
  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly conversationService: ConversationService,
    private readonly sseRunner: SseAgentRunner,
    private readonly sdk: CoreSdkService,
    private readonly planSummarizer: PlanSummarizer,
  ) {}

  @Get('conversations')
  async listConversations(@CurrentUser() user: CurrentUserType) {
    return this.conversationService.listByUser(user.id, user.tenantId);
  }

  @Get('conversations/:id/turns')
  async getConversationTurns(@CurrentUser() user: CurrentUserType, @Param('id') id: string) {
    const turns = await this.conversationService.getHistory(id);
    // Enrich persisted tool calls with a back-translated planSummary so reloaded
    // conversations show the same query-plan transparency as live streaming (ADR-0029).
    return Promise.all(
      turns.map(async (turn) => {
        if (!Array.isArray(turn.toolCalls) || turn.toolCalls.length === 0) return turn;
        const enriched = await Promise.all(
          (turn.toolCalls as Array<{ name: string; args: Record<string, unknown> }>).map(async (tc) => ({
            ...tc,
            planSummary:
              (await this.planSummarizer.summarize(user.tenantId, tc.name, tc.args ?? {})) ?? undefined,
          })),
        );
        return { ...turn, toolCalls: enriched };
      }),
    );
  }

  @Post('confirm')
  async confirm(
    @CurrentUser() user: CurrentUserType,
    @Body() body: { conversationId: string; confirmed: boolean; comment?: string },
    @Res() res: Response,
  ) {
    await this.sseRunner.stream(
      res,
      this.orchestrator.resume({
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

    const { summary, typeNames } = await this.sdk.getSchemaSummary(user.tenantId);

    await this.sseRunner.stream(
      res,
      this.orchestrator.run({
        user,
        message: dto.message,
        conversationId: conversation.id,
        history,
        fileId: dto.fileId,
        schemaSummary: summary,
        objectTypeNames: typeNames,
      }),
      conversation.id,
    );
  }
}

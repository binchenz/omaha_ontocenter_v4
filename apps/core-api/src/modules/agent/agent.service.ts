import { Injectable } from '@nestjs/common';
import { LlmMessage } from './llm/llm-client.interface';
import { AgentTool } from './tools/tool.interface';
import { AgentSkill } from './skills/skill.interface';
import { ConfirmationGate } from './confirmation/confirmation-gate.service';
import { CurrentUser as CurrentUserType } from '@omaha/shared-types';
import { OrchestratorService, AgentEvent, RunInput } from '../orchestrator/orchestrator.service';
import { LlmClient } from './llm/llm-client.interface';

export type { AgentEvent, RunInput };

/**
 * Thin shell — delegates all orchestration to OrchestratorService.
 * Kept for backward compatibility with AgentController and existing tests.
 */
@Injectable()
export class AgentService {
  private readonly orchestrator: OrchestratorService;

  constructor(
    llm: LlmClient,
    tools: AgentTool[],
    skills: AgentSkill[] = [],
    confirmationGate?: ConfirmationGate,
  ) {
    this.orchestrator = new OrchestratorService(llm, tools, skills, confirmationGate);
  }

  run(input: RunInput): AsyncGenerator<AgentEvent> {
    return this.orchestrator.run(input);
  }

  resume(input: {
    user: CurrentUserType;
    conversationId: string;
    confirmed: boolean;
    comment?: string;
  }): AsyncGenerator<AgentEvent> {
    return this.orchestrator.resume(input);
  }
}

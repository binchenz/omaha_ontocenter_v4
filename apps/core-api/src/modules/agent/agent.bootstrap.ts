import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { AgentTool } from './tools/tool.interface';
import { AgentSkill } from './skills/skill.interface';
import { findOrphanedTools } from './sdk/find-orphaned-tools';
import { AGENT_TOOLS, AGENT_SKILLS } from './agent.tokens';

@Injectable()
export class AgentBootstrap implements OnModuleInit {
  constructor(
    @Inject(AGENT_TOOLS) private readonly tools: AgentTool[],
    @Inject(AGENT_SKILLS) private readonly skills: AgentSkill[],
  ) {}

  onModuleInit(): void {
    const toolNames = this.tools.map(t => t.name);
    const orphans = findOrphanedTools(toolNames, this.skills);
    if (orphans.length > 0) {
      throw new Error(
        `Agent configuration error: tool(s) registered but not declared by any skill: ${orphans.join(', ')}. ` +
        `Add the tool name(s) to a skill's tools[] array, or remove the tool registration.`,
      );
    }
  }
}

import { Injectable, OnApplicationBootstrap, Inject } from '@nestjs/common';
import { AgentSkill } from './skills/skill.interface';
import { findOrphanedTools, findDanglingToolRefs } from './sdk/find-orphaned-tools';
import { AGENT_SKILLS } from '../tool-registry/tool-registry.tokens';
import { ToolCollector } from '../tool-registry/tool-collector.service';

/**
 * Validates at startup that every registered Agent tool is declared by some skill.
 *
 * Runs at onApplicationBootstrap (not onModuleInit): tool collection depends on every
 * module's providers being instantiated, which is only guaranteed after the init phase.
 * Collects fresh from ToolCollector rather than reading the AGENT_TOOLS array so this is
 * independent of provider/hook ordering.
 */
@Injectable()
export class AgentBootstrap implements OnApplicationBootstrap {
  constructor(
    private readonly toolCollector: ToolCollector,
    @Inject(AGENT_SKILLS) private readonly skills: AgentSkill[],
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const toolNames = (await this.toolCollector.collect()).map((t) => t.name);
    const orphans = findOrphanedTools(toolNames, this.skills);
    if (orphans.length > 0) {
      throw new Error(
        `Agent configuration error: tool(s) registered but not declared by any skill: ${orphans.join(', ')}. ` +
        `Add the tool name(s) to a skill's tools[] array, or remove the tool registration.`,
      );
    }

    const dangling = findDanglingToolRefs(toolNames, this.skills);
    if (dangling.length > 0) {
      throw new Error(
        `Agent configuration error: skill(s) declare tool(s) not registered in AGENT_TOOLS: ${dangling.join(', ')}. ` +
        `Register the tool (add its class to a module's providers), or remove the name from the skill's tools[] array.`,
      );
    }
  }
}

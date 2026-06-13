import { Injectable, OnApplicationBootstrap, Type } from '@nestjs/common';
import { DiscoveryService, ModuleRef } from '@nestjs/core';
import { AgentTool } from '../agent/tools/tool.interface';
import { IS_AGENT_TOOL } from './tool-registry.tokens';

/**
 * Collects every AgentTool-marked provider in the application container into one
 * array (ADR-0052). Replaces the non-functional `multi: true` registry: NestJS does
 * not support Angular-style multi-providers, so the prior approach yielded a single
 * object instead of an array, crashing app boot.
 *
 * Timing: DiscoveryService reports provider WRAPPERS (with their class metatype) but a
 * wrapper's `instance` is null until something instantiates it. To be independent of
 * instantiation order we force-resolve every marked class via ModuleRef.resolve()
 * ({ strict: false } searches the whole app) — this actually CONSTRUCTS the provider,
 * unlike .get() which only returns an already-built singleton. Results are deduped by
 * tool name (keep first).
 *
 * AGENT_TOOLS consumers receive the stable `tools` array reference, filled in place at
 * onApplicationBootstrap (after every module's providers exist). They read it at request
 * time, long after the fill, so they always see the full set.
 */
@Injectable()
export class ToolCollector implements OnApplicationBootstrap {
  /** Stable reference handed to AGENT_TOOLS consumers; populated in place at bootstrap. */
  private readonly tools: AgentTool[] = [];

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const collected = await this.collect();
    this.tools.length = 0;
    this.tools.push(...collected);
  }

  /** The stable array reference injected as AGENT_TOOLS. */
  getTools(): AgentTool[] {
    return this.tools;
  }

  /** Fresh discovery of all marked tool instances, deduped by tool name (keep first). */
  async collect(): Promise<AgentTool[]> {
    const byName = new Map<string, AgentTool>();

    for (const wrapper of this.discovery.getProviders()) {
      const metatype = wrapper.metatype as Type<AgentTool> | undefined;
      if (!metatype || !Reflect.getMetadata(IS_AGENT_TOOL, metatype)) continue;

      let instance = wrapper.instance as AgentTool | undefined;
      if (!instance || !instance.name) {
        // Force construction — .get() only returns already-built singletons, .resolve()
        // instantiates on demand so collection never depends on eager init order.
        try {
          instance = await this.moduleRef.resolve<AgentTool>(metatype, undefined, { strict: false });
        } catch {
          continue; // unresolvable — skip rather than crash boot
        }
      }

      if (instance && instance.name && !byName.has(instance.name)) {
        byName.set(instance.name, instance);
      }
    }

    return [...byName.values()];
  }
}

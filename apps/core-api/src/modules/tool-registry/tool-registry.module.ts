import { Global, Module, Provider, Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AGENT_TOOLS, IS_AGENT_TOOL } from './tool-registry.tokens';
import { AgentTool } from '../agent/tools/tool.interface';
import { ToolCollector } from './tool-collector.service';

/**
 * Tool Registry — module self-registration seam (ADR-0052).
 *
 * NestJS does NOT support Angular-style `multi: true` providers (they resolve to a
 * single object, not an array), so the original multi-provider approach silently
 * yielded a one-tool "array" and crashed app boot. This version marks each tool class
 * with the IS_AGENT_TOOL metadata flag and collects every marked provider at runtime
 * via DiscoveryService (see ToolCollector). AGENT_TOOLS is provided here as the
 * aggregated array and exported globally.
 *
 * Usage (inside the module that owns the tools):
 *
 *   @Module({
 *     providers: [ActionExecutor, CreateActionTool, ExecuteActionTool,
 *                 ...ToolRegistryModule.providers(CreateActionTool, ExecuteActionTool)],
 *   })
 *   export class ActionModule {}
 *
 * `providers(...)` applies the marker as a side effect and returns [] — the tool
 * classes themselves are provided explicitly by the owning module.
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    ToolCollector,
    {
      // Stable array reference; ToolCollector fills it in place at onApplicationBootstrap
      // (after every provider exists). Consumers read it at runtime, not instantiation time.
      provide: AGENT_TOOLS,
      useFactory: (collector: ToolCollector) => collector.getTools(),
      inject: [ToolCollector],
    },
  ],
  exports: [AGENT_TOOLS, ToolCollector],
})
export class ToolRegistryModule {
  /** Mark tool classes so DiscoveryService collects them into AGENT_TOOLS. Returns [] (marker is a side effect). */
  static providers(...toolClasses: Type<AgentTool>[]): Provider[] {
    for (const toolClass of toolClasses) {
      Reflect.defineMetadata(IS_AGENT_TOOL, true, toolClass);
    }
    return [];
  }
}

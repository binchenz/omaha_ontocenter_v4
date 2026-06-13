import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from '../../agent/tools/tool.interface';
import { TransformConfigService } from '../transform-config.service';

/**
 * Agent tool: list reusable TransformConfigs (#169). Returns the latest version of
 * each named config so the Agent can discover what already exists before authoring
 * a Pipeline. Tenant-scoped from request context.
 */
@Injectable()
export class ListTransformConfigsTool implements AgentTool {
  name = 'list_transform_configs';
  description = '列出当前租户已有的转换配置（每个名称取最新版本），返回 { name, type, version }[]。';
  parameters = {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };
  requiresConfirmation = false;

  constructor(private readonly service: TransformConfigService) {}

  async execute(_args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const configs = await this.service.list(context.user.tenantId);
    return configs.map((c) => ({ name: c.name, type: c.type, version: c.version }));
  }
}

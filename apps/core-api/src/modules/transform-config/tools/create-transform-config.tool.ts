import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from '../../agent/tools/tool.interface';
import { TransformConfigService, TransformConfigType } from '../transform-config.service';
import { TRANSFORM_CONFIG_SCHEMAS } from '../transform-config.schemas';

/**
 * Agent tool: create (or version-bump) a reusable TransformConfig (#169, ADR-0054).
 * `type` is enum-constrained (ADR-0026). Tenant comes from request context, not a param.
 * Same-name creates a new append-only version.
 */
@Injectable()
export class CreateTransformConfigTool implements AgentTool {
  name = 'create_transform_config';
  description =
    '创建可复用的转换配置（如品牌词典、价格分档）。同名会追加新版本。返回 { id, name, version }。';
  parameters = {
    type: 'object',
    properties: {
      name: { type: 'string', description: '配置名称（同名追加新版本）' },
      type: {
        type: 'string',
        enum: Object.keys(TRANSFORM_CONFIG_SCHEMAS),
        description: 'brand_mapping=品牌归一词典；price_bands=价格分档',
      },
      config: { type: 'object', description: '配置内容，结构由 type 决定' },
    },
    required: ['name', 'type', 'config'],
    additionalProperties: false,
  };
  requiresConfirmation = false;

  constructor(private readonly service: TransformConfigService) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const created = await this.service.create(context.user.tenantId, {
      name: args.name as string,
      type: args.type as TransformConfigType,
      config: args.config as Record<string, unknown>,
    });
    return { id: created.id, name: created.name, version: created.version };
  }
}

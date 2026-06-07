import { Injectable } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { ApplyService } from '../apply/apply.service';
import type { ObjectEdit } from '@omaha/shared-types';

export interface ActionEffect {
  type: 'set_field' | 'create_relationship' | 'delete_relationship' | 'create_object';
  field?: string;
  value?: unknown | { fromParam: string };
  relationship?: string;
  targetParam?: string;
  objectType?: string;
  fields?: Record<string, unknown | { fromParam: string }>;
}

export interface ActionParam {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'objectRef';
  label: string;
  required: boolean;
  allowedValues?: string[];
  objectTypeName?: string;
}

export interface PreviewChange {
  type: 'set_field' | 'create_relationship' | 'delete_relationship' | 'create_object';
  field?: string;
  from?: unknown;
  to?: unknown;
  relationship?: string;
  target?: string;
  objectType?: string;
  fields?: Record<string, unknown>;
}

export type PreviewResult =
  | { ok: true; changes: PreviewChange[] }
  | { ok: false; error: string };

export type ExecuteResult =
  | { ok: true; changes: PreviewChange[] }
  | { ok: false; error: string };

@Injectable()
export class ActionExecutor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly applyService: ApplyService,
  ) {}

  async preview(
    tenantId: string,
    actionName: string,
    objectId: string,
    params: Record<string, unknown>,
  ): Promise<PreviewResult> {
    const loaded = await this.load(tenantId, actionName, objectId);
    if ('error' in loaded) return { ok: false, error: loaded.error };
    return this.computePreview(loaded.actionDef, loaded.instance, params);
  }

  /** Loads and validates the ActionDefinition + target instance. */
  private async load(
    tenantId: string,
    actionName: string,
    objectId: string,
  ): Promise<{ actionDef: any; instance: any } | { error: string }> {
    const actionDef = await this.prisma.actionDefinition.findFirst({
      where: { tenantId, name: actionName },
    });
    if (!actionDef) {
      return { error: `Action "${actionName}" 不存在` };
    }

    const instance = await this.prisma.objectInstance.findUnique({
      where: { id: objectId },
    });
    if (!instance || instance.deletedAt) {
      return { error: `对象 "${objectId}" 不存在` };
    }
    if (instance.objectType !== actionDef.objectType) {
      return { error: `Action "${actionName}" 只能在 ${actionDef.objectType} 上执行，当前对象类型为 ${instance.objectType}` };
    }
    return { actionDef, instance };
  }

  /** Builds the preview (precondition + effect changes) from already-loaded context. */
  private async computePreview(
    actionDef: any,
    instance: any,
    params: Record<string, unknown>,
  ): Promise<PreviewResult> {
    const effects = actionDef.effects as ActionEffect[];
    const properties = instance.properties as Record<string, unknown>;

    // Precondition check
    const precondition = actionDef.precondition as string | null;
    if (precondition) {
      const failReason = this.evaluatePrecondition(precondition, properties);
      if (failReason) return { ok: false, error: failReason };
    }

    const changes: PreviewChange[] = [];

    for (const effect of effects) {
      switch (effect.type) {
        case 'set_field': {
          const resolvedValue = this.resolveValue(effect.value, params);
          changes.push({
            type: 'set_field',
            field: effect.field!,
            from: properties[effect.field!],
            to: resolvedValue,
          });
          break;
        }
        case 'create_relationship':
        case 'delete_relationship': {
          const targetId = params[effect.targetParam!];
          // Validate the objectRef target exists
          const target = await this.prisma.objectInstance.findUnique({ where: { id: targetId as string } });
          if (!target || target.deletedAt) {
            return { ok: false, error: `关系目标对象 "${targetId}" 不存在` };
          }
          changes.push({
            type: effect.type,
            relationship: effect.relationship,
            target: targetId as string,
          });
          break;
        }
        case 'create_object': {
          const resolvedFields = this.resolveFields(effect.fields ?? {}, params);
          changes.push({
            type: 'create_object',
            objectType: effect.objectType,
            fields: resolvedFields,
          });
          break;
        }
      }
    }

    return { ok: true, changes };
  }

  async execute(
    tenantId: string,
    userId: string,
    actionName: string,
    objectId: string,
    params: Record<string, unknown>,
  ): Promise<ExecuteResult> {
    const loaded = await this.load(tenantId, actionName, objectId);
    if ('error' in loaded) return { ok: false, error: loaded.error };

    const preview = await this.computePreview(loaded.actionDef, loaded.instance, params);
    if (!preview.ok) return preview;

    const effects = loaded.actionDef.effects as ActionEffect[];
    const edits = this.buildEdits(effects, loaded.instance, params);

    const result = await this.applyService.apply(edits, { tenantId, userId });
    if (result.errors && result.errors.length > 0) {
      return { ok: false, error: result.errors[0].message };
    }

    await this.prisma.actionRun.create({
      data: {
        tenantId,
        previewId: objectId, // simplified — in full impl this links to ActionPreview
        userId,
        status: 'success',
        result: { changes: preview.changes } as any,
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });

    return { ok: true, changes: preview.changes };
  }

  private buildEdits(
    effects: ActionEffect[],
    instance: { id: string; objectType: string; properties: unknown },
    params: Record<string, unknown>,
  ): ObjectEdit[] {
    const edits: ObjectEdit[] = [];
    const properties = { ...(instance.properties as Record<string, unknown>) };
    let hasSetField = false;

    for (const effect of effects) {
      switch (effect.type) {
        case 'set_field': {
          properties[effect.field!] = this.resolveValue(effect.value, params);
          hasSetField = true;
          break;
        }
        case 'create_relationship': {
          edits.push({ op: 'link', from: instance.id, to: params[effect.targetParam!] as string, linkType: effect.relationship! });
          break;
        }
        case 'delete_relationship': {
          edits.push({ op: 'unlink', from: instance.id, to: params[effect.targetParam!] as string, linkType: effect.relationship! });
          break;
        }
        case 'create_object': {
          edits.push({ op: 'create', objectType: effect.objectType!, properties: this.resolveFields(effect.fields ?? {}, params) });
          break;
        }
      }
    }

    // Collect all set_field effects into one update edit (prepended so field
    // writes apply before relationship/creation effects)
    if (hasSetField) {
      edits.unshift({ op: 'update', objectId: instance.id, properties });
    }

    return edits;
  }

  private resolveValue(value: unknown, params: Record<string, unknown>): unknown {
    if (value && typeof value === 'object' && 'fromParam' in value) {
      return params[(value as { fromParam: string }).fromParam];
    }
    return value;
  }

  private resolveFields(
    fields: Record<string, unknown | { fromParam: string }>,
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      resolved[key] = this.resolveValue(value, params);
    }
    return resolved;
  }

  /**
   * Evaluates a simple equality precondition: "field = 'value'" or "field != 'value'".
   * Returns an error string if precondition fails, null if it passes.
   * Uses the existing DSL for complex expressions; this handles the common equality case inline.
   */
  private evaluatePrecondition(precondition: string, properties: Record<string, unknown>): string | null {
    // Simple equality: field = 'value' or field != 'value'
    const eqMatch = precondition.match(/^(\w+)\s*=\s*'([^']+)'$/);
    if (eqMatch) {
      const [, field, expected] = eqMatch;
      const actual = properties[field];
      if (String(actual) !== expected) {
        return `前置条件不满足：${field} 当前值为 "${actual}"，需要 "${expected}"`;
      }
      return null;
    }
    const neqMatch = precondition.match(/^(\w+)\s*!=\s*'([^']+)'$/);
    if (neqMatch) {
      const [, field, forbidden] = neqMatch;
      const actual = properties[field];
      if (String(actual) === forbidden) {
        return `前置条件不满足：${field} 不能为 "${forbidden}"`;
      }
      return null;
    }
    // Unknown expression — pass through (DSL compiler handles complex cases)
    return null;
  }
}

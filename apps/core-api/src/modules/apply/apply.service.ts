import { Injectable } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import type { ObjectEdit, ApplyContext, ApplyResult } from '@omaha/shared-types';
import { randomUUID } from 'crypto';
import { ViewManagerService } from '../ontology/view-manager.service';

@Injectable()
export class ApplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly viewManager: ViewManagerService,
  ) {}

  async apply(edits: ObjectEdit[], ctx: ApplyContext): Promise<ApplyResult> {
    const errors: Array<{ index: number; message: string }> = [];
    const created: string[] = [];

    // Validation pass
    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      const error = await this.validate(edit, ctx);
      if (error) {
        errors.push({ index: i, message: error });
      }
    }

    if (errors.length > 0) {
      return { applied: 0, created: [], errors };
    }

    if (ctx.dryRun) {
      // Simulate IDs for created instances
      for (const edit of edits) {
        if (edit.op === 'create') created.push('dry-run-id');
      }
      return { applied: edits.length, created };
    }

    // Execute in transaction
    const affectedObjectTypes = new Set<string>();
    await this.prisma.$transaction(async (tx) => {
      for (const edit of edits) {
        switch (edit.op) {
          case 'create': {
            const instance = await tx.objectInstance.create({
              data: {
                tenantId: ctx.tenantId,
                objectType: edit.objectType,
                externalId: edit.externalId ?? randomUUID(),
                label: edit.label ?? null,
                properties: edit.properties as any,
                relationships: {},
              },
            });
            created.push(instance.id);
            affectedObjectTypes.add(edit.objectType);
            break;
          }
          case 'update': {
            const inst = await tx.objectInstance.findUnique({ where: { id: edit.objectId }, select: { objectType: true } });
            await tx.objectInstance.update({
              where: { id: edit.objectId },
              data: {
                properties: edit.properties as any,
                ...(edit.label !== undefined && { label: edit.label }),
              },
            });
            if (inst) affectedObjectTypes.add(inst.objectType);
            break;
          }
          case 'delete': {
            const inst = await tx.objectInstance.findUnique({ where: { id: edit.objectId }, select: { objectType: true } });
            await tx.objectInstance.update({
              where: { id: edit.objectId },
              data: { deletedAt: new Date() },
            });
            if (inst) affectedObjectTypes.add(inst.objectType);
            break;
          }
          case 'link': {
            const instance = await tx.objectInstance.findUnique({ where: { id: edit.from } });
            const relationships = (instance?.relationships as Record<string, unknown>) ?? {};
            relationships[edit.linkType] = edit.to;
            await tx.objectInstance.update({
              where: { id: edit.from },
              data: { relationships: relationships as any },
            });
            if (instance) affectedObjectTypes.add(instance.objectType);
            break;
          }
          case 'unlink': {
            const instance = await tx.objectInstance.findUnique({ where: { id: edit.from } });
            const relationships = { ...((instance?.relationships as Record<string, unknown>) ?? {}) };
            delete relationships[edit.linkType];
            await tx.objectInstance.update({
              where: { id: edit.from },
              data: { relationships: relationships as any },
            });
            if (instance) affectedObjectTypes.add(instance.objectType);
            break;
          }
        }
      }
    });

    // Refresh materialized views for affected objectTypes post-commit.
    // Per ADR-0020, refresh is best-effort: the write has already committed,
    // so refresh failure must not propagate back to the caller. ViewManager
    // logs failures internally; we use allSettled to isolate one view's
    // failure from the others.
    if (!ctx.batchMode) {
      await Promise.allSettled(
        Array.from(affectedObjectTypes).map(ot => this.viewManager.refresh(ctx.tenantId, ot)),
      );
    }

    return { applied: edits.length, created };
  }

  private async validate(edit: ObjectEdit, ctx: ApplyContext): Promise<string | null> {
    switch (edit.op) {
      case 'create': {
        const objectType = await this.prisma.objectType.findFirst({
          where: { tenantId: ctx.tenantId, name: edit.objectType },
        });
        if (!objectType) return `Object type '${edit.objectType}' not found for this tenant`;
        return null;
      }
      case 'update': {
        const instance = await this.prisma.objectInstance.findUnique({ where: { id: edit.objectId } });
        if (!instance || instance.deletedAt) return `Instance '${edit.objectId}' not found`;
        return null;
      }
      case 'delete': {
        const instance = await this.prisma.objectInstance.findUnique({ where: { id: edit.objectId } });
        if (!instance || instance.deletedAt) return `Instance '${edit.objectId}' not found`;
        return null;
      }
      case 'link':
      case 'unlink': {
        const instance = await this.prisma.objectInstance.findUnique({ where: { id: edit.from } });
        if (!instance) return `Instance '${edit.from}' not found`;
        return null;
      }
    }
  }
}

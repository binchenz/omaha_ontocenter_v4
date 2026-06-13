import { Injectable } from '@nestjs/common';
import { PrismaService } from '@omaha/db';
import { FileParserService } from '../agent/tools/file-parser.service';
import { DatasetService } from '../dataset/dataset.service';
import { SyncJobService } from '../dataset/sync-job.service';
import { PendingActionService } from '../pending-action/pending-action.service';
import { InlineTransform, InlineTransformEngine } from './inline-transform-engine';
import * as path from 'path';

export const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

export interface AgentImportPayload {
  fileId: string;
  objectType: string;
  transforms: InlineTransform[];
  mapping: Record<string, string>;
  totalRows: number;
}

@Injectable()
export class AgentImportExecutor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileParser: FileParserService,
    private readonly datasetService: DatasetService,
    private readonly syncJobService: SyncJobService,
    private readonly pendingActionService: PendingActionService,
  ) {}

  async execute(tenantId: string, actionId: string, payload: AgentImportPayload): Promise<void> {
    try {
      await this.pendingActionService.markExecuting(tenantId, actionId);

      const filePath = path.join(UPLOAD_DIR, payload.fileId);
      const rows = await this.fileParser.parseAll(filePath);

      const transformed = InlineTransformEngine.apply(rows, payload.transforms);

      const renamed = transformed.map(row => {
        const out: Record<string, unknown> = { ...row };
        for (const [src, dst] of Object.entries(payload.mapping)) {
          if (src in out) {
            out[dst] = out[src];
            delete out[src];
          }
        }
        return out;
      });

      // Upsert a system connector for agent-driven imports
      const connector = await this.prisma.connector.upsert({
        where: { tenantId_name: { tenantId, name: '__agent_import__' } } as any,
        create: { tenantId, name: '__agent_import__', type: 'agent', config: {} },
        update: {},
      });

      const dataset = await this.datasetService.createDataset(tenantId, {
        name: `agent_import_${actionId}`,
        connectorId: connector.id,
        kind: 'raw',
      });

      await this.datasetService.appendRows(tenantId, dataset.id, renamed);
      await this.datasetService.markReady(tenantId, dataset.id);

      // Find or create ObjectMapping for this objectType + connector
      const objectType = await this.prisma.objectType.findFirstOrThrow({
        where: { tenantId, name: payload.objectType },
        select: { id: true },
      });
      const mapping = await this.prisma.objectMapping.upsert({
        where: { tenantId_objectTypeId: { tenantId, objectTypeId: objectType.id } },
        create: { tenantId, objectTypeId: objectType.id, connectorId: connector.id },
        update: {},
      });

      const syncJob = await this.syncJobService.enqueue(tenantId, dataset.id, mapping.id);

      await this.pendingActionService.markCompleted(tenantId, actionId, {
        syncJobId: syncJob.id,
        rowsQueued: renamed.length,
      });
    } catch (err: any) {
      await this.pendingActionService.markFailed(tenantId, actionId, err?.message ?? String(err));
    }
  }
}

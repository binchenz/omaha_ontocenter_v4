import { Injectable, Logger } from '@nestjs/common';
import { PropertyDefinition } from '@omaha/shared-types';
import { IndexManagerService, IndexReconcileResult } from './index-manager.service';
import { ViewManagerService } from './view-manager.service';

export interface ReconcileResult {
  indexes: IndexReconcileResult;
  viewName: string | null;
}

@Injectable()
export class ArtifactManagerService {
  private readonly logger = new Logger(ArtifactManagerService.name);

  constructor(
    private readonly indexManager: IndexManagerService,
    private readonly viewManager: ViewManagerService,
  ) {}

  async reconcile(
    tenantId: string,
    objectTypeId: string,
    objectTypeName: string,
    properties: PropertyDefinition[],
  ): Promise<ReconcileResult> {
    const indexes = await this.indexManager.reconcile(tenantId, objectTypeId);

    let viewName: string | null = null;
    try {
      viewName = await this.viewManager.createOrReplace(tenantId, objectTypeName, properties);
    } catch (err) {
      this.logger.warn({
        msg: 'materialized view creation failed — queries will use base table',
        tenantId,
        objectType: objectTypeName,
        error: (err as Error).message,
      });
    }

    return { indexes, viewName };
  }

  async dropAll(tenantId: string, objectTypeId: string, objectTypeName: string): Promise<void> {
    await this.indexManager.dropAllFor(tenantId, objectTypeId);
    try {
      await this.viewManager.drop(tenantId, objectTypeName);
    } catch (err) {
      this.logger.warn({
        msg: 'materialized view drop failed',
        tenantId,
        objectType: objectTypeName,
        error: (err as Error).message,
      });
    }
  }
}

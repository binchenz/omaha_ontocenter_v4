import { Injectable } from '@nestjs/common';
import { CurrentUser as CurrentUserType } from '@omaha/shared-types';
import { CoreSdkService, OntologySchema } from '../../sdk/core-sdk.service';

/**
 * Thin adapter kept for backward compatibility with existing tools.
 * All logic lives in CoreSdkService (src/modules/sdk/).
 */
@Injectable()
export class OntologySdkService {
  constructor(private readonly core: CoreSdkService) {}

  getSchema(tenantId: string): Promise<OntologySchema> {
    return this.core.getSchema(tenantId);
  }

  queryObjects(user: CurrentUserType, req: any) {
    return this.core.queryObjects(user, req);
  }

  aggregateObjects(user: CurrentUserType, req: any) {
    return this.core.aggregateObjects(user, req);
  }

  createObjectType(tenantId: string, dto: Parameters<CoreSdkService['createObjectType']>[1]) {
    return this.core.createObjectType(tenantId, dto);
  }

  updateObjectType(tenantId: string, params: Parameters<CoreSdkService['updateObjectType']>[1]) {
    return this.core.updateObjectType(tenantId, params);
  }

  deleteObjectType(tenantId: string, objectTypeName: string) {
    return this.core.deleteObjectType(tenantId, objectTypeName);
  }

  createRelationship(tenantId: string, params: Parameters<CoreSdkService['createRelationship']>[1]) {
    return this.core.createRelationship(tenantId, params);
  }

  deleteRelationship(tenantId: string, params: Parameters<CoreSdkService['deleteRelationship']>[1]) {
    return this.core.deleteRelationship(tenantId, params);
  }
}

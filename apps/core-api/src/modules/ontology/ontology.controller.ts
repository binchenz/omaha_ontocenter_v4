import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, HttpCode } from '@nestjs/common';
import { OntologyService } from './ontology.service';
import { IndexManagerService } from './index-manager.service';
import { DraftService } from './draft.service';
import { PublishService } from './publish.service';
import { TemplateService } from './template.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateObjectTypeDto } from './dto/create-object-type.dto';
import { UpdateObjectTypeDto } from './dto/update-object-type.dto';
import { CreateRelationshipDto } from './dto/create-relationship.dto';
import { OntologySnapshotCodec } from '@omaha/shared-types';

@Controller('ontology')
@UseGuards(JwtAuthGuard)
export class OntologyController {
  constructor(
    private readonly ontologyService: OntologyService,
    private readonly indexManager: IndexManagerService,
    private readonly draftService: DraftService,
    private readonly publishService: PublishService,
    private readonly templateService: TemplateService,
  ) {}

  @Get('types')
  listTypes(@CurrentUser('tenantId') tenantId: string): Promise<unknown> {
    return this.ontologyService.listObjectTypes(tenantId);
  }

  @Get('types/:id')
  getType(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string): Promise<unknown> {
    return this.ontologyService.getObjectType(tenantId, id);
  }

  @Post('types')
  createType(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateObjectTypeDto): Promise<unknown> {
    return this.ontologyService.createObjectType(tenantId, dto);
  }

  @Put('types/:id')
  updateType(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string, @Body() dto: UpdateObjectTypeDto): Promise<unknown> {
    return this.ontologyService.updateObjectType(tenantId, id, dto);
  }

  @Delete('types/:id')
  deleteType(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string): Promise<unknown> {
    return this.ontologyService.deleteObjectType(tenantId, id);
  }

  @Post('types/:id/reconcile-indexes')
  @HttpCode(200)
  reconcileIndexes(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.indexManager.reconcile(tenantId, id);
  }

  @Post('types/:id/derived-properties/validate')
  @HttpCode(200)
  validateDerived(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() body: { expression: string },
  ): Promise<unknown> {
    return this.ontologyService.validateDerivedExpression(tenantId, id, body.expression);
  }

  @Get('relationships')
  listRelationships(@CurrentUser('tenantId') tenantId: string): Promise<unknown> {
    return this.ontologyService.listRelationships(tenantId);
  }

  @Post('relationships')
  createRelationship(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateRelationshipDto): Promise<unknown> {
    return this.ontologyService.createRelationship(tenantId, dto);
  }

  @Delete('relationships/:id')
  deleteRelationship(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string): Promise<unknown> {
    return this.ontologyService.deleteRelationship(tenantId, id);
  }

  // --- Draft lifecycle (ADR-0030/0031: OPC design-time workbench) ---

  /** Current Draft (snapshot + status), or `{ draft: null }` if none exists. */
  @Get('draft')
  async getDraft(@CurrentUser('tenantId') tenantId: string): Promise<unknown> {
    return { draft: (await this.draftService.getDraft(tenantId)) ?? null };
  }

  /** Create a Draft by snapshotting the live published ontology (idempotent). */
  @Post('draft')
  @HttpCode(200)
  createDraft(@CurrentUser('tenantId') tenantId: string): Promise<unknown> {
    return this.draftService.createFromPublished(tenantId);
  }

  /**
   * Replace the Draft snapshot wholesale (workbench edit path). The body is the full
   * snapshot the workbench computed from the OPC's edits; the codec normalizes it and
   * validateSnapshot gates it before storage. Requires an existing Draft.
   */
  @Put('draft')
  @HttpCode(200)
  replaceDraft(
    @CurrentUser('tenantId') tenantId: string,
    @Body() body: { snapshot: unknown },
  ): Promise<unknown> {
    const snapshot = OntologySnapshotCodec.decode(body?.snapshot);
    return this.draftService.replaceSnapshot(tenantId, snapshot);
  }

  /** Discard the Draft (rollback all pending changes). */
  @Delete('draft')
  @HttpCode(204)
  async discardDraft(@CurrentUser('tenantId') tenantId: string): Promise<void> {
    await this.draftService.discard(tenantId);
  }

  /** Publish preflight: diff + safe/breaking classification + breaking-change impact counts. */
  @Get('draft/preflight')
  preflight(@CurrentUser('tenantId') tenantId: string): Promise<unknown> {
    return this.publishService.preflight(tenantId);
  }

  /**
   * Publish the Draft to production (schema only; instances untouched) and clear it.
   * Breaking changes require `confirmed: true` in the body (informed gate, ADR-0031).
   */
  @Post('draft/publish')
  @HttpCode(200)
  publishDraft(
    @CurrentUser('tenantId') tenantId: string,
    @Body() body: { confirmed?: boolean } = {},
  ): Promise<unknown> {
    return this.publishService.publish(tenantId, { confirmed: body?.confirmed });
  }

  // --- Template library (ADR-0034: per-OPC private toolbox) ---

  /** List all private templates (tenant-independent storage). */
  @Get('templates')
  listTemplates(): Promise<unknown> {
    return this.templateService.list();
  }

  /** Save the current ontology (draft if present, else published) + question bank as a de-identified template. */
  @Post('templates')
  saveTemplate(
    @CurrentUser('tenantId') tenantId: string,
    @Body() body: { name: string; description?: string },
  ): Promise<unknown> {
    return this.templateService.saveAsTemplate(tenantId, body);
  }

  @Delete('templates/:id')
  @HttpCode(204)
  async deleteTemplate(@Param('id') id: string): Promise<void> {
    await this.templateService.remove(id);
  }

  /** Apply a template: instantiate its snapshot into a Draft + seed the Evals question bank. */
  @Post('templates/:id/apply')
  @HttpCode(200)
  applyTemplate(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string): Promise<unknown> {
    return this.templateService.apply(tenantId, id);
  }
}

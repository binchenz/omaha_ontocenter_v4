import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, HttpCode } from '@nestjs/common';
import { OntologyService } from './ontology.service';
import { IndexManagerService } from './index-manager.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateObjectTypeDto } from './dto/create-object-type.dto';
import { UpdateObjectTypeDto } from './dto/update-object-type.dto';
import { CreateRelationshipDto } from './dto/create-relationship.dto';

@Controller('ontology')
@UseGuards(JwtAuthGuard)
export class OntologyController {
  constructor(
    private readonly ontologyService: OntologyService,
    private readonly indexManager: IndexManagerService,
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
}

import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { MappingService } from './mapping.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateMappingDto } from './dto/create-mapping.dto';
import { CreateMappingRequest } from '@omaha/shared-types';

@Controller('mappings')
@UseGuards(JwtAuthGuard)
export class MappingController {
  constructor(private readonly mappingService: MappingService) {}

  @Get()
  list(@CurrentUser('tenantId') tenantId: string): Promise<unknown> {
    return this.mappingService.listMappings(tenantId);
  }

  @Get(':id')
  get(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string): Promise<unknown> {
    return this.mappingService.getMapping(tenantId, id);
  }

  @Post()
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateMappingDto): Promise<unknown> {
    return this.mappingService.createMapping(tenantId, dto as unknown as CreateMappingRequest);
  }

  @Delete(':id')
  delete(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string): Promise<unknown> {
    return this.mappingService.deleteMapping(tenantId, id);
  }
}

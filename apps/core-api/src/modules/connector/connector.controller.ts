import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ConnectorService } from './connector.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateConnectorDto } from './dto/create-connector.dto';
import { UpdateConnectorDto } from './dto/update-connector.dto';

@Controller('connectors')
@UseGuards(JwtAuthGuard)
export class ConnectorController {
  constructor(private readonly connectorService: ConnectorService) {}

  @Get()
  list(@CurrentUser('tenantId') tenantId: string): Promise<unknown> {
    return this.connectorService.listConnectors(tenantId);
  }

  @Get(':id')
  get(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string): Promise<unknown> {
    return this.connectorService.getConnector(tenantId, id);
  }

  @Post()
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateConnectorDto): Promise<unknown> {
    return this.connectorService.createConnector(tenantId, dto);
  }

  @Put(':id')
  update(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string, @Body() dto: UpdateConnectorDto): Promise<unknown> {
    return this.connectorService.updateConnector(tenantId, id, dto);
  }

  @Delete(':id')
  delete(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string): Promise<unknown> {
    return this.connectorService.deleteConnector(tenantId, id);
  }
}

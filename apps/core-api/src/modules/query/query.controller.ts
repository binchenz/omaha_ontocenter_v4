import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { QueryService } from './query.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { QueryObjectsDto } from './dto/query-objects.dto';
import { CurrentUser as CurrentUserType } from '@omaha/shared-types';

@Controller('query')
@UseGuards(JwtAuthGuard)
export class QueryController {
  constructor(private readonly queryService: QueryService) {}

  @Post('objects')
  queryObjects(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: QueryObjectsDto,
  ): Promise<unknown> {
    return this.queryService.queryObjects(user, dto);
  }
}

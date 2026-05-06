import { IsString, IsOptional, IsArray, IsInt, Min, Max, ValidateNested, IsIn, MinLength, ArrayMinSize, Allow } from 'class-validator';
import { Type } from 'class-transformer';
import { FilterOperator } from '@omaha/shared-types';

class QueryFilterDto {
  @IsOptional()
  @IsString()
  field?: string;

  @IsOptional()
  @IsString()
  derivedProperty?: string;

  @IsIn(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in'])
  operator!: FilterOperator;

  @Allow()
  value!: unknown;

  @IsOptional()
  @Allow()
  params?: Record<string, unknown>;
}

class AggregateMetricDto {
  /**
   * Forward-compatible metric kinds. v1 (slice #40) only emits SQL for `count`.
   * #42 adds sum/avg/min/max; #43 adds countDistinct.
   * `field` is required for sum/avg/min/max/countDistinct, forbidden for count —
   * enforced in the planner, not at DTO level (discriminated-union DTOs are awkward).
   */
  @IsIn(['count', 'countDistinct', 'sum', 'avg', 'min', 'max'])
  kind!: 'count' | 'countDistinct' | 'sum' | 'avg' | 'min' | 'max';

  @IsOptional()
  @IsString()
  field?: string;

  @IsString()
  @MinLength(1)
  alias!: string;
}

class AggregateOrderByDto {
  @IsIn(['metric', 'groupKey'])
  kind!: 'metric' | 'groupKey';

  @IsString()
  @MinLength(1)
  by!: string;

  @IsIn(['asc', 'desc'])
  direction!: 'asc' | 'desc';
}

export class AggregateObjectsDto {
  @IsString()
  @MinLength(1)
  objectType!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QueryFilterDto)
  filters?: QueryFilterDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  groupBy?: string[];

  /**
   * Required, non-empty. Empty/missing → service layer rejects with
   * stable METRICS_REQUIRED error code (more useful for the agent than
   * class-validator's default error shape).
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AggregateMetricDto)
  metrics?: AggregateMetricDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AggregateOrderByDto)
  orderBy?: AggregateOrderByDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  maxGroups?: number;

  @IsOptional()
  @IsString()
  pageToken?: string;
}

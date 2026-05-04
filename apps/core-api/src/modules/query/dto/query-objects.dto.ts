import { IsString, IsOptional, IsArray, IsInt, Min, Max, ValidateNested, IsIn, MinLength, Allow } from 'class-validator';
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

class QuerySortDto {
  @IsString()
  field!: string;

  @IsIn(['asc', 'desc'])
  direction!: 'asc' | 'desc';
}

export class QueryObjectsDto {
  @IsString()
  @MinLength(1)
  objectType!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QueryFilterDto)
  filters?: QueryFilterDto[];

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => QuerySortDto)
  sort?: QuerySortDto;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

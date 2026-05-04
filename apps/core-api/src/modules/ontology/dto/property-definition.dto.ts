import { IsString, IsOptional, IsIn, IsBoolean, IsInt, Min } from 'class-validator';

export class PropertyDefinitionDto {
  @IsString()
  name!: string;

  @IsString()
  label!: string;

  @IsString()
  @IsIn(['string', 'number', 'boolean', 'date', 'json'])
  type!: 'string' | 'number' | 'boolean' | 'date' | 'json';

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsBoolean()
  filterable?: boolean;

  @IsOptional()
  @IsBoolean()
  sortable?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  precision?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  scale?: number;
}

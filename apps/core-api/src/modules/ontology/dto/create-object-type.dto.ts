import { IsString, IsArray, IsOptional, MinLength, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

class PropertyDefinitionDto {
  @IsString()
  name!: string;

  @IsString()
  label!: string;

  @IsString()
  @IsIn(['string', 'number', 'boolean', 'date', 'json'])
  type!: 'string' | 'number' | 'boolean' | 'date' | 'json';

  @IsOptional()
  required?: boolean;
}

export class CreateObjectTypeDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  label!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PropertyDefinitionDto)
  properties!: PropertyDefinitionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PropertyDefinitionDto)
  derivedProperties?: PropertyDefinitionDto[];
}

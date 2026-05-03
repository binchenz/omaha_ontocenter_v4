import { IsString, IsArray, IsOptional, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PropertyDefinitionDto } from './property-definition.dto';

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

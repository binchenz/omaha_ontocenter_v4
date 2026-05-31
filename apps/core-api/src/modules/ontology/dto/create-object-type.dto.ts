import { IsString, IsArray, IsOptional, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PropertyDefinitionDto } from './property-definition.dto';
import { DerivedPropertyDefinitionDto } from './derived-property-definition.dto';

export class CreateObjectTypeDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  label!: string;

  // Without this, the whitelist ValidationPipe strips the type-level description on create.
  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PropertyDefinitionDto)
  properties!: PropertyDefinitionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DerivedPropertyDefinitionDto)
  derivedProperties?: DerivedPropertyDefinitionDto[];
}

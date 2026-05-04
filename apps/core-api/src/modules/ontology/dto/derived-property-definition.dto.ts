import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PropertyDefinitionDto } from './property-definition.dto';

class DerivedPropertyParamDto {
  @IsString()
  name!: string;

  @IsIn(['datetime', 'decimal', 'string', 'int', 'boolean'])
  type!: 'datetime' | 'decimal' | 'string' | 'int' | 'boolean';
}

export class DerivedPropertyDefinitionDto extends PropertyDefinitionDto {
  @IsString()
  expression!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DerivedPropertyParamDto)
  params?: DerivedPropertyParamDto[];
}

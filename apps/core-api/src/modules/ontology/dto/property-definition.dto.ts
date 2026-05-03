import { IsString, IsOptional, IsIn, IsBoolean } from 'class-validator';

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
}

import { IsString, IsOptional, IsIn, IsBoolean, IsInt, Min, IsArray, ArrayNotEmpty } from 'class-validator';

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

  // Semantic-annotation fields (ADR-0023). Without these declared, the whitelist
  // ValidationPipe silently strips them on the create/update path — deleting the very
  // payload the ontology relies on to disambiguate fields (description/unit) and gate
  // values (allowedValues). Required for the editable workbench (#70) and projection (#67).
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  allowedValues?: string[];
}

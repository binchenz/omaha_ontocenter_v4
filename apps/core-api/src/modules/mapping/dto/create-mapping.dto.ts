import { IsString, IsUUID, IsObject, IsOptional, MinLength } from 'class-validator';

export class CreateMappingDto {
  @IsUUID()
  objectTypeId!: string;

  @IsUUID()
  connectorId!: string;

  @IsString()
  @MinLength(1)
  tableName!: string;

  @IsObject()
  propertyMappings!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  relationshipMappings?: Record<string, unknown>;
}

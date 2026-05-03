import { IsString, IsObject, IsOptional, MinLength, IsIn } from 'class-validator';

export class UpdateConnectorDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsIn(['active', 'inactive', 'error'])
  status?: string;
}

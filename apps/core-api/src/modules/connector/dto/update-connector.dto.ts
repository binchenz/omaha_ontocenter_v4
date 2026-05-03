import { IsString, IsObject, IsOptional, MinLength } from 'class-validator';

export class UpdateConnectorDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  status?: string;
}

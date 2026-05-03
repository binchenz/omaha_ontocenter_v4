import { IsString, IsObject, MinLength } from 'class-validator';

export class CreateConnectorDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  type!: string;

  @IsObject()
  config!: Record<string, unknown>;
}

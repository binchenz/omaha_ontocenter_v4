import { IsString, IsEmail, MinLength } from 'class-validator';

export class InitializeDto {
  @IsString() declare tenantName: string;
  @IsEmail() declare adminEmail: string;
  @IsString() @MinLength(6) declare adminPassword: string;
  @IsString() declare apiKey: string;
}

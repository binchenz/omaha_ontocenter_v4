import { IsString } from 'class-validator';
import { PropertyDefinitionDto } from './property-definition.dto';

export class DerivedPropertyDefinitionDto extends PropertyDefinitionDto {
  @IsString()
  expression!: string;
}

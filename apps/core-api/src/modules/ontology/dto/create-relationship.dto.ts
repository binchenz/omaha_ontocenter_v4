import { IsString, IsUUID, IsIn } from 'class-validator';
import { Cardinality } from '@omaha/shared-types';

export class CreateRelationshipDto {
  @IsUUID()
  sourceTypeId!: string;

  @IsUUID()
  targetTypeId!: string;

  @IsString()
  name!: string;

  @IsIn(['one-to-one', 'one-to-many', 'many-to-many'])
  cardinality!: Cardinality;
}

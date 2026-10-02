import { IsString, MinLength } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @MinLength(1)
  name: string;
}

export class CreateTeamDto {
  @IsString()
  @MinLength(1)
  name: string;
}

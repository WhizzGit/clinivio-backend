import { IsOptional, IsString, IsNumberString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SearchPatientDto {
  @ApiPropertyOptional({ description: 'Search by name, phone, or UHID' }) @IsOptional() @IsString() q?: string;
  @ApiPropertyOptional({ default: '1' }) @IsOptional() @IsNumberString() page?: string;
  @ApiPropertyOptional({ default: '20' }) @IsOptional() @IsNumberString() limit?: string;
}

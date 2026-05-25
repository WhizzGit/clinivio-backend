import { IsString, IsEnum, IsNumber, IsOptional, IsBoolean, IsPositive, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { RoomType } from '@prisma/client';

export class CreateRoomDto {
  @ApiProperty() @IsString() name: string;
  @ApiProperty({ enum: RoomType }) @IsEnum(RoomType) roomType: RoomType;
  @ApiPropertyOptional() @IsOptional() @IsString() floor?: string;
  @ApiProperty() @IsNumber() @IsPositive() @Type(() => Number) totalBeds: number;
  @ApiProperty() @IsNumber() @Min(0) @Type(() => Number) pricePerDay: number;
  @ApiPropertyOptional() @IsOptional() amenities?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class UpdateRoomDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional({ enum: RoomType }) @IsOptional() @IsEnum(RoomType) roomType?: RoomType;
  @ApiPropertyOptional() @IsOptional() @IsString() floor?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsPositive() @Type(() => Number) totalBeds?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Type(() => Number) pricePerDay?: number;
  @ApiPropertyOptional() @IsOptional() amenities?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateBedStatusDto {
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

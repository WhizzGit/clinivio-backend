import { IsString, IsNumber, IsEnum, IsArray, ValidateNested, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class InvoiceLineItemDto {
  @ApiProperty()
  @IsString()
  description: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  quantity: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  hsnCode?: string;
}

export enum InvoiceTypeEnum {
  CONSULTATION = 'CONSULTATION',
  PHARMACY = 'PHARMACY',
  PROCEDURE = 'PROCEDURE',
  LAB = 'LAB',
  PACKAGE = 'PACKAGE',
}

export class CreateInvoiceDto {
  @ApiProperty()
  @IsString()
  patientId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  appointmentId?: string;

  @ApiProperty({ enum: InvoiceTypeEnum })
  @IsEnum(InvoiceTypeEnum)
  invoiceType: InvoiceTypeEnum;

  @ApiProperty({ type: [InvoiceLineItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineItemDto)
  lineItems: InvoiceLineItemDto[];

  @ApiProperty({ required: false, description: 'Patient state code for IGST vs CGST+SGST' })
  @IsOptional()
  @IsString()
  patientStateCode?: string;

  @ApiProperty({ required: false, description: 'Hospital state code' })
  @IsOptional()
  @IsString()
  hospitalStateCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

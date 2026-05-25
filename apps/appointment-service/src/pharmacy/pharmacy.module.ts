import { Module } from '@nestjs/common';
import { PharmacyController } from './pharmacy.controller';
import { PharmacyService } from './pharmacy.service';
import { PrismaService } from '@mediflow/database';

@Module({
  controllers: [PharmacyController],
  providers: [PharmacyService, PrismaService],
  exports: [PharmacyService],
})
export class PharmacyModule {}

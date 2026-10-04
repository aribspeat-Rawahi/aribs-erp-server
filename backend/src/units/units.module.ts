import { Global, Module } from '@nestjs/common';
import { UnitService } from './unit.service';

// Global so every document module can inject UnitService without imports.
@Global()
@Module({ providers: [UnitService], exports: [UnitService] })
export class UnitsModule {}

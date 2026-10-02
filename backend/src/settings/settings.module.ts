import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Settings } from './settings.entity';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { CompanyDocument } from './company-document.entity';
import { CompanyDocumentService } from './company-document.service';
import { CompanyDocumentController } from './company-document.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Settings, CompanyDocument])],
  controllers: [SettingsController, CompanyDocumentController],
  providers: [SettingsService, CompanyDocumentService],
  exports: [SettingsService],
})
export class SettingsModule {}

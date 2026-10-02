import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeliveryNote } from './delivery-note.entity';
import { DeliveryNoteItem } from './delivery-note-item.entity';
import { DeliveryNoteService } from './delivery-note.service';
import { DeliveryNoteController } from './delivery-note.controller';
import { CustomerModule } from '../customer/customer.module';
import { SettingsModule } from '../settings/settings.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [TypeOrmModule.forFeature([DeliveryNote, DeliveryNoteItem]), CustomerModule, SettingsModule, ActivityLogModule],
  controllers: [DeliveryNoteController],
  providers: [DeliveryNoteService],
  exports: [DeliveryNoteService],
})
export class DeliveryNoteModule {}

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntitySubscriberInterface, RemoveEvent } from 'typeorm';
import { deletionContext } from './deletion-context';
import { DeletedRecord } from './deleted-record.entity';

// Copies every row that repository/manager .remove() deletes during a
// DELETE request (including child rows) into the request's deletion
// context, so DeletedRecordsService can store and later restore them.
@Injectable()
export class DeletionCaptureSubscriber implements EntitySubscriberInterface {
  constructor(@InjectDataSource() dataSource: DataSource) {
    dataSource.subscribers.push(this);
  }

  beforeRemove(event: RemoveEvent<any>) {
    const ctx = deletionContext.getStore();
    if (!ctx || !event.entity || event.metadata.target === DeletedRecord) return;
    const data: Record<string, unknown> = {};
    for (const col of event.metadata.columns) {
      let value = col.getEntityValue(event.entity);
      // a join column may hand back the related object instead of its id
      if (col.relationMetadata && value && typeof value === 'object' && !(value instanceof Date)) value = (value as { id?: unknown }).id;
      if (value !== undefined) data[col.propertyPath] = value instanceof Date ? value.toISOString() : value;
    }
    ctx.rows.push({ entity: event.metadata.name, table: event.metadata.tableName, data });
  }
}

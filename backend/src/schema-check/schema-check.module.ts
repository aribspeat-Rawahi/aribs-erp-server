import { Module } from '@nestjs/common';
import { SchemaCheckService } from './schema-check.service';

@Module({ providers: [SchemaCheckService] })
export class SchemaCheckModule {}

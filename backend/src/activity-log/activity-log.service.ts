import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityLog } from './activity-log.entity';

export interface LogEntryInput {
  userId?: string;
  userEmail?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
}

@Injectable()
export class ActivityLogService {
  constructor(
    @InjectRepository(ActivityLog)
    private repo: Repository<ActivityLog>,
  ) {}

  // Fire-and-forget style: callers do `await this.activityLog.log(...)`
  // right after the action they want recorded. Never throws — a logging
  // failure should not break the actual business operation.
  async log(entry: LogEntryInput) {
    try {
      const row = this.repo.create({
        userId: entry.userId,
        userEmail: entry.userEmail,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        details: entry.details ? JSON.stringify(entry.details) : undefined,
      });
      await this.repo.save(row);
    } catch {
      // Swallow — logging must never break the caller's real operation.
    }
  }

  findAll(filters?: { entityType?: string; entityId?: string; userId?: string }) {
    const where: Record<string, string> = {};
    if (filters?.entityType) where.entityType = filters.entityType;
    if (filters?.entityId) where.entityId = filters.entityId;
    if (filters?.userId) where.userId = filters.userId;
    return this.repo.find({ where, order: { createdAt: 'DESC' }, take: 200 });
  }
}

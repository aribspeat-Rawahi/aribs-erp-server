import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, In, IsNull, LessThan, Like } from 'typeorm';
import * as fs from 'fs';
import { DeletedRecord } from './deleted-record.entity';
import { CapturedRow, DeletionContext } from './deletion-context';
import { routeInfo, routeKey } from './deleted-records.registry';
import { User, UserRole } from '../auth/user.entity';
import { ActivityLog } from '../activity-log/activity-log.entity';
import { EmailService } from '../common/email.service';
import { InvoiceService } from '../invoice/invoice.service';
import { ModuleRef } from '@nestjs/core';
import { InvoicePaymentService } from '../invoice/invoice-payment.service';
import { SupplierPaymentService } from '../supplier/supplier-payment.service';
import { FundTransferService } from '../bank-account/fund-transfer.service';
import { TaxPaymentService } from '../tax/tax-payment.service';
import { VendorCreditService } from '../supplier/vendor-credit.service';
import { VendorPrepaymentService } from '../supplier/vendor-prepayment.service';
import { FixedAssetService } from '../fixed-asset/fixed-asset.service';
import { RestoreService } from './deleted-records.registry';
import { JournalPostingService } from '../journal/journal-posting.service';

// The services that put money records back (resolved lazily so this
// module doesn't have to import every module).
const RESTORE_SERVICES: Record<RestoreService, any> = {
  invoicePayment: InvoicePaymentService,
  supplierPayment: SupplierPaymentService,
  fundTransfer: FundTransferService,
  taxPayment: TaxPaymentService,
  vendorCredit: VendorCreditService,
  vendorPrepayment: VendorPrepaymentService,
  fixedAsset: FixedAssetService,
};

const UNDO_DAYS = 30;
const NOTIFY_ROLES = [UserRole.ADMIN, UserRole.CEO, UserRole.MD, UserRole.ACCOUNTANT];
// fields tried, in order, to name the deleted record
const NAME_FIELDS = [
  'invoiceNumber',
  'deliveryNoteNumber',
  'quotationNumber',
  'returnNumber',
  'orderNumber',
  'poNumber',
  'batchNumber',
  'entryNumber',
  'transferNumber',
  'paymentNumber',
  'creditNumber',
  'prepaymentNumber',
  'assetNumber',
  'claimNumber',
  'name',
  'title',
  'originalName',
  'fileName',
  'description',
];
const SKIP_DETAIL = /(^id$|Id$|Hash$|Path$|^sequenceNumber$|^createdAt$|^updatedAt$|^modulePermissions$)/;

interface Actor {
  userId?: string;
  email?: string;
  role?: string;
}

@Injectable()
export class DeletedRecordsService {
  private readonly logger = new Logger(DeletedRecordsService.name);

  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private config: ConfigService,
    private email: EmailService,
    private invoiceService: InvoiceService,
    private moduleRef: ModuleRef,
    private journalPosting: JournalPostingService,
  ) {}

  // Undo must not bring a document back into closed books (filed VAT
  // return / before the opening date): its journal entry could not be
  // re-posted there, and filed figures would change.
  private async assertRestoreDatesOpen(rows: CapturedRow[], label: string) {
    const DATE_FIELDS = ['date', 'issueDate', 'paymentDate', 'datePaid', 'purchaseDate', 'receivedDate', 'paidDate', 'disposalDate'];
    for (const row of rows) {
      for (const f of DATE_FIELDS) {
        const v = row.data?.[f];
        if (v) await this.journalPosting.assertDateOpen(String(v).slice(0, 10), `"${label}"`);
      }
    }
  }

  private get repo() {
    return this.dataSource.getRepository(DeletedRecord);
  }

  // ---- record -------------------------------------------------------------

  // Called by the interceptor after a DELETE request succeeded.
  async record(
    req: { route?: { path?: string }; params?: Record<string, string>; user?: Actor; ip?: string; headers?: Record<string, unknown> },
    ctx: DeletionContext,
  ) {
    const key = routeKey(req.route?.path || '');
    const info = routeInfo(key);
    const params = req.params || {};
    const entityId = Object.values(params).pop() || null;
    const main = ctx.rows.find((r) => r.data.id === entityId) || ctx.rows[ctx.rows.length - 1];

    let restorable = !!info.restore;
    let reason: string | null = null;
    if (!info.restore) reason = info.type === 'user' ? 'User accounts are restored with Team > Recall.' : 'This kind of record can\'t be undone - re-enter it by hand if needed.';
    else if (ctx.notRestorableReason) {
      restorable = false;
      reason = ctx.notRestorableReason;
    } else if ((info.restore === 'generic' || info.restore === 'service') && ctx.rows.length === 0) {
      restorable = false;
      reason = 'Nothing was captured to restore.';
    }

    const user = req.user?.userId ? await this.dataSource.getRepository(User).findOne({ where: { id: req.user.userId } }) : null;
    const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    const label = await this.buildLabel(info.label, main);

    const saved = await this.repo.save(
      this.repo.create({
        entityType: info.type,
        entityId,
        label: label.slice(0, 500),
        route: `DELETE /${key}`.slice(0, 300),
        snapshot: JSON.stringify({ rows: ctx.rows, files: ctx.files }),
        deletedByUserId: req.user?.userId || null,
        deletedByEmail: user?.email || req.user?.email || null,
        deletedByName: user?.name || null,
        deletedByRole: user?.role || req.user?.role || null,
        ipAddress: (forwarded || req.ip || '').slice(0, 64) || null,
        restorable,
        notRestorableReason: reason,
        restoreExpiresAt: restorable ? new Date(Date.now() + UNDO_DAYS * 86400000) : null,
      }),
    );

    await this.linkActivityLog(saved);
    // email in the background - a mail problem must never fail the delete
    this.notifyDeleted(saved, main).catch((err) => this.logger.warn(`Delete notice email failed: ${err?.message || err}`));
    return saved;
  }

  // A delete that failed: put parked files back.
  unparkFiles(ctx: DeletionContext) {
    for (const f of ctx.files) {
      try {
        if (fs.existsSync(f.to) && !fs.existsSync(f.from)) fs.renameSync(f.to, f.from);
      } catch {
        /* best-effort */
      }
    }
  }

  private async buildLabel(typeLabel: string, main?: CapturedRow) {
    if (!main) return typeLabel;
    const d = main.data;
    const nameField = NAME_FIELDS.find((f) => d[f] !== undefined && d[f] !== null && String(d[f]).trim() !== '');
    let label = `${typeLabel} ${nameField ? String(d[nameField]).slice(0, 120) : `#${String(d.id || '').slice(0, 8)}`}`;
    if (typeof d.customerId === 'string') {
      const c = await this.dataSource.query('SELECT name FROM customers WHERE id = ?', [d.customerId]).catch(() => []);
      if (c?.[0]?.name) label += ` - ${c[0].name}`;
    }
    if (d.total !== undefined && d.total !== null) label += ` - ${Number(d.total).toFixed(3)} OMR`;
    else if (d.amount !== undefined && d.amount !== null) label += ` - ${Number(d.amount).toFixed(3)} OMR`;
    return label;
  }

  // One Activity Log row per delete: reuse the service's own
  // "<type>.deleted" row when it wrote one, else add one.
  private async linkActivityLog(rec: DeletedRecord) {
    try {
      const logRepo = this.dataSource.getRepository(ActivityLog);
      const extra = {
        deletedRecordId: rec.id,
        label: rec.label,
        deletedByRole: rec.deletedByRole,
        ipAddress: rec.ipAddress,
        restorable: rec.restorable,
      };
      // the service's own "<type>.deleted" row for this id that isn't
      // linked to a deleted record yet = the one written by this request
      const latestOwn = rec.entityId
        ? await logRepo.findOne({ where: { entityId: rec.entityId, action: Like('%.deleted') }, order: { createdAt: 'DESC' } })
        : null;
      const own = latestOwn && !(latestOwn.details || '').includes('"deletedRecordId"') ? latestOwn : null;
      if (own) {
        let details: Record<string, unknown> = {};
        try {
          details = own.details ? JSON.parse(own.details) : {};
        } catch {
          details = { note: own.details };
        }
        own.details = JSON.stringify({ ...details, ...extra });
        await logRepo.save(own);
      } else {
        await logRepo.save(
          logRepo.create({
            userId: rec.deletedByUserId || undefined,
            userEmail: rec.deletedByEmail || undefined,
            action: `${rec.entityType}.deleted`,
            entityType: rec.entityType,
            entityId: rec.entityId || undefined,
            details: JSON.stringify(extra),
          }),
        );
      }
    } catch (err) {
      this.logger.warn(`Activity log for delete failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ---- email ----------------------------------------------------------------

  private async recipients() {
    const users = await this.dataSource.getRepository(User).find({ where: { role: In(NOTIFY_ROLES), active: true, deletedAt: IsNull() } });
    return [...new Set(users.map((u) => u.email).filter((e) => !!e && e.includes('@')))];
  }

  private when(d: Date) {
    return d.toLocaleString('en-GB', { timeZone: 'Asia/Muscat', dateStyle: 'medium', timeStyle: 'medium' }) + ' (Oman time)';
  }

  private undoUrl(id: string) {
    const base = (this.config.get<string>('PUBLIC_BASE_URL') || '').trim().replace(/\/+$/, '');
    return base ? `${base}/activity-log?restore=${id}` : null;
  }

  private async notifyDeleted(rec: DeletedRecord, main?: CapturedRow) {
    const to = await this.recipients();
    if (!to.length) return;
    const who = [rec.deletedByName, rec.deletedByEmail].filter(Boolean).join(' - ') || 'Unknown user';
    const details = main
      ? Object.entries(main.data)
          .filter(([k, v]) => !SKIP_DETAIL.test(k) && v !== null && v !== '' && typeof v !== 'object')
          .slice(0, 14)
          .map(([k, v]) => `  ${k}: ${String(v).slice(0, 120)}`)
      : [];
    const url = this.undoUrl(rec.id);
    const lines = [
      'A record was deleted in ARIBS ERP.',
      '',
      `What:     ${rec.label}`,
      `Deleted by: ${who}${rec.deletedByRole ? ` (${rec.deletedByRole})` : ''}`,
      `When:     ${this.when(new Date())}`,
      `IP:       ${rec.ipAddress || '-'}`,
      `Record ID: ${rec.id}`,
      '',
      ...(details.length ? ['Deleted data:', ...details, ''] : []),
      rec.restorable
        ? url
          ? `Undo this delete (Admin, CEO, MD or Accountant login needed, within ${UNDO_DAYS} days):\n${url}`
          : `Undo: open Activity Log > Deleted in the ERP (within ${UNDO_DAYS} days).`
        : `Undo not available: ${rec.notRestorableReason}`,
    ];
    await this.email.sendPlainNotice(to, `Deleted: ${rec.label.slice(0, 120)} - by ${rec.deletedByEmail || 'unknown'}`, lines.join('\n'));
  }

  // ---- read -----------------------------------------------------------------

  async findAll() {
    const rows = await this.repo.find({ order: { deletedAt: 'DESC' }, take: 300 });
    return rows.map(({ snapshot, ...r }) => ({ ...r, canUndo: this.canUndo(r as DeletedRecord) }));
  }

  async findOne(id: string) {
    const rec = await this.repo.findOne({ where: { id } });
    if (!rec) throw new NotFoundException('Deleted record not found');
    const snap = JSON.parse(rec.snapshot) as { rows: CapturedRow[] };
    const { snapshot, ...rest } = rec;
    return { ...rest, canUndo: this.canUndo(rec), rows: snap.rows.map((r) => ({ table: r.table, data: r.data })) };
  }

  private canUndo(rec: DeletedRecord) {
    return rec.restorable && !rec.restoredAt && (!rec.restoreExpiresAt || new Date(rec.restoreExpiresAt) > new Date());
  }

  // ---- undo -----------------------------------------------------------------

  async restore(id: string, actor: Actor) {
    const rec = await this.repo.findOne({ where: { id } });
    if (!rec) throw new NotFoundException('Deleted record not found');
    if (rec.restoredAt) throw new BadRequestException(`Already restored by ${rec.restoredByEmail || 'someone'}.`);
    if (!rec.restorable) throw new BadRequestException(`This delete can't be undone: ${rec.notRestorableReason || 'not supported'}`);
    if (rec.restoreExpiresAt && new Date(rec.restoreExpiresAt) < new Date()) {
      throw new BadRequestException(`The ${UNDO_DAYS}-day undo window for this delete has passed.`);
    }

    const snapForLock = JSON.parse(rec.snapshot) as { rows: CapturedRow[] };
    await this.assertRestoreDatesOpen(snapForLock.rows || [], rec.label || 'This record');

    // claim it first so two clicks can't restore twice
    const claim = await this.repo.update({ id, restoredAt: IsNull() }, { restoredAt: new Date(), restoredByEmail: actor.email || null });
    if (!claim.affected) throw new BadRequestException('Already restored.');

    const snap = JSON.parse(rec.snapshot) as { rows: CapturedRow[]; files: { from: string; to: string }[] };
    const info = routeInfo(rec.route.replace(/^DELETE \//, ''));
    try {
      if (info.parent) {
        const parentRow = snap.rows.find((r) => r.data.id === rec.entityId) || snap.rows[0];
        const parentId = parentRow?.data[info.parent.param];
        if (parentId) {
          const exists = await this.dataSource.query(`SELECT id FROM \`${info.parent.table}\` WHERE id = ?`, [parentId]);
          if (!exists.length) throw new BadRequestException('The record this belonged to has been deleted too - restore that first.');
        }
      }
      if (info.restore === 'invoice') {
        await this.invoiceService.restoreDeleted(snap.rows, actor);
      } else if (info.restore === 'reactivate' && info.table) {
        await this.dataSource.query(`UPDATE \`${info.table}\` SET active = 1 WHERE id = ?`, [rec.entityId]);
      } else if (info.restore === 'service' && info.service) {
        const main = snap.rows.find((r) => r.entity === info.entity && r.data.id === rec.entityId) || snap.rows.find((r) => r.entity === info.entity);
        if (!main) throw new BadRequestException('Nothing was captured to restore.');
        const svc = this.moduleRef.get(RESTORE_SERVICES[info.service], { strict: false });
        await svc.restoreDeleted(main.data, actor);
      } else {
        await this.insertRows(snap.rows);
      }
    } catch (err) {
      await this.repo.update({ id }, { restoredAt: null, restoredByEmail: null });
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/Duplicate entry/i.test(msg)) {
        throw new BadRequestException('Can\'t undo: a record with the same name/number/code already exists. Rename or remove it, then try again.');
      }
      throw new BadRequestException(`Undo failed: ${msg.slice(0, 200)}`);
    }

    for (const f of snap.files || []) {
      try {
        if (fs.existsSync(f.to) && !fs.existsSync(f.from)) fs.renameSync(f.to, f.from);
      } catch {
        /* best-effort */
      }
    }

    await this.dataSource.getRepository(ActivityLog).save(
      this.dataSource.getRepository(ActivityLog).create({
        userId: actor.userId,
        userEmail: actor.email,
        action: `${rec.entityType}.restored`,
        entityType: rec.entityType,
        entityId: rec.entityId || undefined,
        details: JSON.stringify({ deletedRecordId: rec.id, label: rec.label, deletedBy: rec.deletedByEmail }),
      }),
    );
    this.notifyRestored(rec, actor).catch((err) => this.logger.warn(`Restore notice email failed: ${err?.message || err}`));
    return { restored: true, label: rec.label };
  }

  // Inserts the captured rows back, parents before children (rows were
  // captured children-first), in one transaction.
  private async insertRows(rows: CapturedRow[]) {
    await this.dataSource.transaction(async (manager) => {
      for (const row of [...rows].reverse()) {
        const meta = this.dataSource.entityMetadatas.find((m) => m.name === row.entity);
        if (!meta) throw new Error(`Unknown table ${row.table}`);
        const values: Record<string, unknown> = {};
        for (const col of meta.columns) {
          if (!(col.propertyPath in row.data)) continue;
          let v = row.data[col.propertyPath];
          const isDateTime = col.type === Date || col.type === 'datetime' || col.type === 'timestamp' || col.isCreateDate || col.isUpdateDate;
          if (isDateTime && typeof v === 'string') v = new Date(v);
          values[col.propertyPath] = v;
        }
        await manager.createQueryBuilder().insert().into(meta.target).values(values).execute();
      }
    });
  }

  private async notifyRestored(rec: DeletedRecord, actor: Actor) {
    const to = await this.recipients();
    if (!to.length) return;
    const lines = [
      'A deleted record was restored (undo) in ARIBS ERP.',
      '',
      `What:        ${rec.label}`,
      `Restored by: ${actor.email || 'unknown'}`,
      `When:        ${this.when(new Date())}`,
      `Deleted by:  ${rec.deletedByEmail || 'unknown'}`,
    ];
    await this.email.sendPlainNotice(to, `Restored: ${rec.label.slice(0, 120)}`, lines.join('\n'));
  }

  // Daily: close the undo window after 30 days and drop parked files.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async expireOld() {
    try {
      const old = await this.repo.find({ where: { restorable: true, restoredAt: IsNull(), restoreExpiresAt: LessThan(new Date()) } });
      for (const rec of old) {
        try {
          const snap = JSON.parse(rec.snapshot) as { files?: { to: string }[] };
          for (const f of snap.files || []) if (fs.existsSync(f.to)) fs.unlinkSync(f.to);
        } catch {
          /* best-effort */
        }
        rec.restorable = false;
        rec.notRestorableReason = `The ${UNDO_DAYS}-day undo window has passed.`;
        await this.repo.save(rec);
      }
    } catch (err) {
      this.logger.warn(`Expiring deleted records failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

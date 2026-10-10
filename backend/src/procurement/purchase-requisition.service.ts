import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { randomUUID } from 'crypto';
import { PurchaseRequisition, PurchaseRequisitionItem, RequisitionStatus } from './purchase-requisition.entity';
import { CreateRequisitionDto, UpdateRequisitionDto } from './dto/procurement.dto';
import { DocumentApprovalService, ApprovalActor } from '../document-approval/document-approval.service';
import { UnitService } from '../units/unit.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { RawMaterial } from '../inventory/raw-material.entity';
import { omanToday } from '../common/oman-date';
import { orderedByRequisitionItem } from './requisition-util';

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const isDate = (d?: string | null) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);
const EDITABLE = [RequisitionStatus.PENDING_APPROVAL, RequisitionStatus.REJECTED];

// Purchase Requisition: request -> approval (Settings > Approval rules,
// "Purchase requisition") -> approved -> purchase orders / RFQ made from
// it. No accounting effect.
@Injectable()
export class PurchaseRequisitionService implements OnModuleInit {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private approvals: DocumentApprovalService,
    private units: UnitService,
    private activityLog: ActivityLogService,
  ) {}

  onModuleInit() {
    const decide = (to: RequisitionStatus) => async (manager: EntityManager, id: string) => {
      const pr = await manager.findOne(PurchaseRequisition, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!pr || pr.status !== RequisitionStatus.PENDING_APPROVAL) throw new BadRequestException('This requisition is no longer waiting for approval.');
      pr.status = to;
      await manager.save(pr);
    };
    this.approvals.registerHandler('purchase_requisition', {
      label: 'Purchase requisition',
      onApproved: decide(RequisitionStatus.APPROVED),
      onRejected: decide(RequisitionStatus.REJECTED),
    });
  }

  private async lines(dto: { items?: CreateRequisitionDto['items'] }) {
    if (!dto.items?.length) throw new BadRequestException('Add at least one item.');
    const lines = await this.units.resolveRawMaterialLines(dto.items);
    const found = await this.dataSource.manager.find(RawMaterial, { where: { id: In(lines.map((l) => l.rawMaterialId)) } });
    if (found.length !== new Set(lines.map((l) => l.rawMaterialId)).size) throw new BadRequestException('An item was not found in Inventory.');
    return lines;
  }

  private async startApproval(manager: EntityManager, pr: PurchaseRequisition, itemCount: number, actor: ApprovalActor) {
    const result = await this.approvals.start(manager, {
      type: 'purchase_requisition',
      documentId: pr.id,
      documentNumber: pr.prNumber,
      amount: Number(pr.estimatedTotal),
      summary: `${itemCount} item${itemCount === 1 ? '' : 's'} - ${pr.purpose}`,
      requestedBy: actor,
    });
    pr.status = result === 'approved' ? RequisitionStatus.APPROVED : RequisitionStatus.PENDING_APPROVAL;
    await manager.save(pr);
  }

  async create(dto: CreateRequisitionDto, actor: ApprovalActor) {
    if (!isDate(dto.neededBy)) throw new BadRequestException('Needed-by date must be YYYY-MM-DD.');
    const lines = await this.lines(dto);
    const estimatedTotal = r3(lines.reduce((t, l) => t + r3(Number(l.quantity) * Number(l.estimatedUnitCost || 0)), 0));
    const id = await this.dataSource.transaction(async (manager) => {
      const pr = await manager.save(
        manager.create(PurchaseRequisition, {
          prNumber: `TMP-${randomUUID().replace(/-/g, '').slice(0, 24)}`,
          purpose: dto.purpose.trim(),
          department: dto.department?.trim() || null,
          neededBy: dto.neededBy || null,
          estimatedTotal,
          status: RequisitionStatus.PENDING_APPROVAL,
          requestedByUserId: actor.userId || null,
          requestedByEmail: actor.email || null,
        }),
      );
      pr.prNumber = `PR-${omanToday().slice(0, 4)}-${String(pr.sequenceNumber).padStart(4, '0')}`;
      await manager.save(pr);
      await manager.save(
        lines.map((l) =>
          manager.create(PurchaseRequisitionItem, {
            requisitionId: pr.id,
            rawMaterialId: l.rawMaterialId,
            quantity: Number(l.quantity),
            unit: l.unit,
            estimatedUnitCost: Number(l.estimatedUnitCost || 0),
            note: l.note?.trim() || null,
          }),
        ),
      );
      await this.startApproval(manager, pr, lines.length, actor);
      return pr.id;
    });
    await this.activityLog.log({ userId: actor.userId, userEmail: actor.email, action: 'purchase_requisition.created', entityType: 'purchase_requisition', entityId: id, details: { estimatedTotal } });
    return this.findOne(id);
  }

  // Only while waiting for approval or after a rejection; it goes for
  // approval again.
  async update(id: string, dto: UpdateRequisitionDto, actor: ApprovalActor) {
    if (!isDate(dto.neededBy)) throw new BadRequestException('Needed-by date must be YYYY-MM-DD.');
    const lines = dto.items ? await this.lines(dto) : null;
    await this.dataSource.transaction(async (manager) => {
      const pr = await manager.findOne(PurchaseRequisition, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!pr) throw new NotFoundException('Purchase requisition not found');
      if (!EDITABLE.includes(pr.status)) throw new BadRequestException(`${pr.prNumber} is ${pr.status} - only a requisition waiting for approval or rejected can be changed.`);
      if (dto.purpose !== undefined) pr.purpose = dto.purpose.trim();
      if (dto.department !== undefined) pr.department = dto.department?.trim() || null;
      if (dto.neededBy !== undefined) pr.neededBy = dto.neededBy || null;
      let count = await manager.count(PurchaseRequisitionItem, { where: { requisitionId: id } });
      if (lines) {
        await manager.delete(PurchaseRequisitionItem, { requisitionId: id });
        await manager.save(
          lines.map((l) =>
            manager.create(PurchaseRequisitionItem, {
              requisitionId: id,
              rawMaterialId: l.rawMaterialId,
              quantity: Number(l.quantity),
              unit: l.unit,
              estimatedUnitCost: Number(l.estimatedUnitCost || 0),
              note: l.note?.trim() || null,
            }),
          ),
        );
        pr.estimatedTotal = r3(lines.reduce((t, l) => t + r3(Number(l.quantity) * Number(l.estimatedUnitCost || 0)), 0));
        count = lines.length;
      }
      await manager.save(pr);
      await this.startApproval(manager, pr, count, actor);
    });
    return this.findOne(id);
  }

  async resubmit(id: string, actor: ApprovalActor) {
    await this.dataSource.transaction(async (manager) => {
      const pr = await manager.findOne(PurchaseRequisition, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!pr) throw new NotFoundException('Purchase requisition not found');
      const stuck = pr.status === RequisitionStatus.PENDING_APPROVAL && !(await this.approvals.pendingByDocument('purchase_requisition', [id])).size;
      if (pr.status !== RequisitionStatus.REJECTED && !stuck) throw new BadRequestException('Only a rejected requisition can be sent for approval again.');
      await this.startApproval(manager, pr, await manager.count(PurchaseRequisitionItem, { where: { requisitionId: id } }), actor);
    });
    return this.findOne(id);
  }

  // Cancel = never needed (nothing ordered on it). Close = stop ordering
  // the rest of an approved requisition.
  async cancel(id: string, actor: ApprovalActor) {
    await this.dataSource.transaction(async (manager) => {
      const pr = await manager.findOne(PurchaseRequisition, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!pr) throw new NotFoundException('Purchase requisition not found');
      if (![...EDITABLE, RequisitionStatus.APPROVED].includes(pr.status)) throw new BadRequestException(`${pr.prNumber} is already ${pr.status}.`);
      const items = await manager.find(PurchaseRequisitionItem, { where: { requisitionId: id } });
      const ordered = await orderedByRequisitionItem(manager, items.map((i) => i.id));
      if ([...ordered.values()].some((q) => q > 0)) throw new BadRequestException(`Purchase orders were made from ${pr.prNumber} - use Close instead.`);
      const [rfq] = await manager.query("SELECT rfqNumber FROM rfqs WHERE requisitionId = ? AND status = 'open' LIMIT 1", [id]);
      if (rfq) throw new BadRequestException(`${rfq.rfqNumber} is open for this requisition - cancel it first.`);
      await this.approvals.cancelPending(manager, 'purchase_requisition', id);
      pr.status = RequisitionStatus.CANCELLED;
      await manager.save(pr);
    });
    await this.activityLog.log({ userId: actor.userId, userEmail: actor.email, action: 'purchase_requisition.cancelled', entityType: 'purchase_requisition', entityId: id });
    return this.findOne(id);
  }

  async close(id: string, actor: ApprovalActor) {
    await this.dataSource.transaction(async (manager) => {
      const pr = await manager.findOne(PurchaseRequisition, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!pr) throw new NotFoundException('Purchase requisition not found');
      if (pr.status !== RequisitionStatus.APPROVED) throw new BadRequestException('Only an approved requisition can be closed.');
      pr.status = RequisitionStatus.CLOSED;
      // nothing more will be bought on it: its open RFQs end too
      await manager.query("UPDATE rfqs SET status = 'cancelled' WHERE requisitionId = ? AND status = 'open'", [id]);
      await manager.save(pr);
    });
    await this.activityLog.log({ userId: actor.userId, userEmail: actor.email, action: 'purchase_requisition.closed', entityType: 'purchase_requisition', entityId: id });
    return this.findOne(id);
  }

  // ---- reads ----------------------------------------------------------------

  private async decorate(prs: PurchaseRequisition[]) {
    if (!prs.length) return [];
    const ids = prs.map((p) => p.id);
    const items = await this.dataSource.manager.find(PurchaseRequisitionItem, { where: { requisitionId: In(ids) } });
    const materials = items.length ? await this.dataSource.manager.find(RawMaterial, { where: { id: In([...new Set(items.map((i) => i.rawMaterialId))]) } }) : [];
    const ordered = await orderedByRequisitionItem(this.dataSource.manager, items.map((i) => i.id));
    const orders: { id: string; poNumber: string; status: string; requisitionId: string; total: string }[] = await this.dataSource.query(
      'SELECT id, poNumber, status, requisitionId, total FROM purchase_orders WHERE requisitionId IN (?) ORDER BY sequenceNumber',
      [ids],
    );
    const rfqs: { id: string; rfqNumber: string; status: string; requisitionId: string }[] = await this.dataSource.query(
      'SELECT id, rfqNumber, status, requisitionId FROM rfqs WHERE requisitionId IN (?) ORDER BY sequenceNumber',
      [ids],
    );
    const pending = await this.approvals.pendingByDocument('purchase_requisition', ids);
    const last = await this.approvals.lastDecisionByDocument('purchase_requisition', ids);
    return prs.map((pr) => {
      const lines = items
        .filter((i) => i.requisitionId === pr.id)
        .map((i) => {
          const done = ordered.get(i.id) || 0;
          return {
            ...i,
            quantity: Number(i.quantity),
            estimatedUnitCost: Number(i.estimatedUnitCost),
            materialName: materials.find((m) => m.id === i.rawMaterialId)?.name || 'Unknown item',
            orderedQuantity: done,
            remainingQuantity: Math.max(0, r3(Number(i.quantity) - done)),
          };
        });
      const fullyOrdered = lines.length > 0 && lines.every((l) => l.remainingQuantity <= 0.0005);
      return {
        ...pr,
        estimatedTotal: Number(pr.estimatedTotal),
        items: lines,
        fullyOrdered,
        purchaseOrders: orders.filter((o) => o.requisitionId === pr.id).map((o) => ({ id: o.id, poNumber: o.poNumber, status: o.status, total: Number(o.total || 0) })),
        rfqs: rfqs.filter((q) => q.requisitionId === pr.id).map((q) => ({ id: q.id, rfqNumber: q.rfqNumber, status: q.status })),
        approvalPending: pending.get(pr.id) || null,
        lastDecision: last.get(pr.id) || null,
      };
    });
  }

  async findAll() {
    return this.decorate(await this.dataSource.manager.find(PurchaseRequisition, { order: { sequenceNumber: 'DESC' } }));
  }

  async findOne(id: string) {
    const pr = await this.dataSource.manager.findOne(PurchaseRequisition, { where: { id } });
    if (!pr) throw new NotFoundException('Purchase requisition not found');
    const [out] = await this.decorate([pr]);
    return { ...out, approvalHistory: await this.approvals.history('purchase_requisition', id) };
  }
}

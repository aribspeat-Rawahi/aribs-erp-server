import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApprovalService } from '../approval/approval.service';
import { ApprovalRequestStatus, ApprovalRequestType } from '../approval/approval-request.entity';
import { RawMaterialService } from './raw-material.service';
import { FinishedGoodService } from './finished-good.service';
import { FinishedGood } from './finished-good.entity';
import { AddStockDto } from './dto/raw-material.dto';
import { ScanStockDto } from './dto/finished-good.dto';

// Manual stock-in adds stock value with no purchase or production document
// (Dr Inventory / Cr 5110 Inventory Adjustments), so it moves profit.
// Admin/CEO/MD/Accountant add stock directly; anyone else with Inventory
// access sends a request that one of them approves on the Approvals page.
export const STOCK_IN_DIRECT_ROLES = ['admin', 'ceo', 'md', 'accountant'];

interface Actor {
  userId?: string;
  email?: string;
  role?: string;
}

type StockInPayload =
  | { kind: 'raw_material'; id: string; dto: AddStockDto }
  | { kind: 'finished_good'; dto: ScanStockDto };

@Injectable()
export class StockInRequestService {
  constructor(
    private approvals: ApprovalService,
    private rawMaterials: RawMaterialService,
    private finishedGoods: FinishedGoodService,
    @InjectRepository(FinishedGood) private fgRepo: Repository<FinishedGood>,
  ) {}

  canAddDirectly(role?: string) {
    return !!role && STOCK_IN_DIRECT_ROLES.includes(role);
  }

  private pending(requestId: string) {
    return {
      pendingApproval: true,
      approvalRequestId: requestId,
      message: 'Sent for approval - the stock will be added once an Admin, CEO, MD or Accountant approves it.',
    };
  }

  private money(n: number) {
    return (Math.round(n * 1000) / 1000).toFixed(3);
  }

  async rawMaterialAddStock(id: string, dto: AddStockDto, actor: Actor) {
    if (this.canAddDirectly(actor.role)) return this.rawMaterials.addStock(id, dto);
    const item = await this.rawMaterials.findOne(id);
    const cost = dto.costPerUnit != null ? Number(dto.costPerUnit) : Number(item.costPerUnit);
    const qty = Number(dto.quantity);
    const payload: StockInPayload = { kind: 'raw_material', id, dto };
    const req = await this.approvals.create({
      type: ApprovalRequestType.STOCK_IN,
      entityType: 'stock_in',
      targetId: id,
      payload,
      reason: `Add stock (no purchase order): ${qty} ${item.unit || ''} of ${item.name} at ${this.money(cost)} OMR = ${this.money(qty * cost)} OMR${dto.notes ? ` - ${dto.notes}` : ''}`,
      requestedBy: actor,
    });
    return this.pending(req.id);
  }

  async finishedGoodStockIn(dto: ScanStockDto, actor: Actor) {
    if (this.canAddDirectly(actor.role)) return this.finishedGoods.stockIn(dto);
    const item = await this.fgRepo.findOne({ where: { barcode: dto.barcode } });
    if (!item) throw new NotFoundException('No product matches this barcode');
    const qty = Number(dto.quantity);
    const cost = Number(item.costPerUnit || 0);
    const payload: StockInPayload = { kind: 'finished_good', dto };
    const req = await this.approvals.create({
      type: ApprovalRequestType.STOCK_IN,
      entityType: 'stock_in',
      targetId: item.id,
      payload,
      reason: `Stock in (no production order): ${qty} ${item.unit || ''} of ${item.name} at ${this.money(cost)} OMR = ${this.money(qty * cost)} OMR`,
      requestedBy: actor,
    });
    return this.pending(req.id);
  }

  // Adds the stock exactly as requested; the adjustment is dated the day
  // it is approved.
  async approve(id: string, decidedBy: Actor) {
    const request = await this.approvals.findOne(id);
    if (request.requestedByUserId && request.requestedByUserId === decidedBy.userId) {
      throw new BadRequestException('You cannot approve your own request.');
    }
    await this.approvals.claimPending(id, 'stock_in');
    try {
      const payload = JSON.parse(request.payload) as StockInPayload;
      const result =
        payload.kind === 'raw_material'
          ? await this.rawMaterials.addStock(payload.id, payload.dto)
          : await this.finishedGoods.stockIn(payload.dto);
      await this.approvals.markDecided(id, ApprovalRequestStatus.APPROVED, decidedBy);
      return result;
    } catch (err) {
      await this.approvals.releaseClaim(id);
      throw err;
    }
  }

  reject(id: string, decidedBy: Actor) {
    return this.approvals.reject(id, 'stock_in', decidedBy);
  }
}

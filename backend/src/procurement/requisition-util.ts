import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

const EPS = 0.0005;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

// How much of each requisition line is on purchase orders that still
// count (not cancelled / rejected). Plain SQL so the purchase-order side
// can use it without depending on the procurement module.
export async function orderedByRequisitionItem(
  manager: EntityManager,
  requisitionItemIds: string[],
  excludeOrderId?: string,
): Promise<Map<string, number>> {
  if (!requisitionItemIds.length) return new Map();
  const rows: { id: string; q: string }[] = await manager.query(
    `SELECT poi.requisitionItemId AS id, SUM(poi.quantity) AS q
       FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchaseOrderId
      WHERE poi.requisitionItemId IN (?) AND po.status NOT IN ('cancelled', 'rejected')
        ${excludeOrderId ? 'AND po.id <> ?' : ''}
      GROUP BY poi.requisitionItemId`,
    excludeOrderId ? [requisitionItemIds, excludeOrderId] : [requisitionItemIds],
  );
  return new Map(rows.map((r) => [r.id, r3(Number(r.q))]));
}

// A purchase order made from a requisition: the requisition must be
// approved, every linked line must be one of its lines (same material),
// and no line may be ordered beyond what was approved.
export async function assertRequisitionLines(
  manager: EntityManager,
  requisitionId: string,
  lines: { rawMaterialId: string; quantity: number | string; requisitionItemId?: string | null }[],
  excludeOrderId?: string,
): Promise<string> {
  const [pr] = await manager.query('SELECT id, prNumber, status FROM purchase_requisitions WHERE id = ? FOR UPDATE', [requisitionId]);
  if (!pr) throw new BadRequestException('Purchase requisition not found.');
  if (pr.status !== 'approved') {
    throw new BadRequestException(`${pr.prNumber} is ${String(pr.status).replace('_', ' ')} - only an approved requisition can be ordered.`);
  }
  const items: { id: string; rawMaterialId: string; quantity: string; name: string | null; unit: string }[] = await manager.query(
    `SELECT i.id, i.rawMaterialId, i.quantity, i.unit, m.name FROM purchase_requisition_items i
       LEFT JOIN raw_materials m ON m.id = i.rawMaterialId WHERE i.requisitionId = ?`,
    [requisitionId],
  );
  const ordered = await orderedByRequisitionItem(manager, items.map((i) => i.id), excludeOrderId);
  const adding = new Map<string, number>();
  for (const l of lines) {
    if (!l.requisitionItemId) continue;
    const item = items.find((i) => i.id === l.requisitionItemId);
    if (!item) throw new BadRequestException(`A line is not part of ${pr.prNumber}.`);
    if (item.rawMaterialId !== l.rawMaterialId) throw new BadRequestException(`A line's item does not match ${pr.prNumber}.`);
    adding.set(item.id, r3((adding.get(item.id) || 0) + Number(l.quantity)));
  }
  for (const [id, qty] of adding) {
    const item = items.find((i) => i.id === id)!;
    const left = r3(Number(item.quantity) - (ordered.get(id) || 0));
    if (qty > left + EPS) {
      throw new BadRequestException(`${item.name || 'An item'}: only ${left} ${item.unit} is left to order on ${pr.prNumber} (tried ${qty}).`);
    }
  }
  return pr.prNumber;
}

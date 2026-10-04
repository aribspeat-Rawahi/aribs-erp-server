import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { FinishedGood } from '../inventory/finished-good.entity';
import { RawMaterial } from '../inventory/raw-material.entity';
import { normalizeUnit, quantityProblem, Unit } from './units';

// Gives every document line its unit and enforces the quantity rule
// (pcs/bags whole numbers, kg/litre/ton up to 3 decimals).
// A line linked to a product ALWAYS takes the product's unit (set once in
// the product form); a custom line uses the unit sent with it (default pcs).
@Injectable()
export class UnitService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async resolveProductLines<T extends { finishedGoodId?: string | null; unit?: string | null; quantity: number | string; description?: string }>(
    items: T[],
    manager?: EntityManager,
  ): Promise<(T & { unit: Unit })[]> {
    const ids = [...new Set(items.map((i) => i.finishedGoodId).filter((id): id is string => !!id))];
    const repo = (manager || this.dataSource.manager).getRepository(FinishedGood);
    const products = ids.length ? await repo.find({ where: { id: In(ids) } }) : [];
    const byId = new Map(products.map((p) => [p.id, p]));
    return items.map((item) => {
      const product = item.finishedGoodId ? byId.get(item.finishedGoodId) : undefined;
      const unit = product ? normalizeUnit(product.unit) : normalizeUnit(item.unit);
      this.assertQuantity(Number(item.quantity), unit, product?.name || item.description || 'an item');
      return { ...item, unit };
    });
  }

  async resolveRawMaterialLines<T extends { rawMaterialId: string; quantity: number | string }>(
    items: T[],
    manager?: EntityManager,
  ): Promise<(T & { unit: Unit })[]> {
    const ids = [...new Set(items.map((i) => i.rawMaterialId).filter(Boolean))];
    const repo = (manager || this.dataSource.manager).getRepository(RawMaterial);
    const materials = ids.length ? await repo.find({ where: { id: In(ids) } }) : [];
    const byId = new Map(materials.map((m) => [m.id, m]));
    return items.map((item) => {
      const material = byId.get(item.rawMaterialId);
      const unit = normalizeUnit(material?.unit);
      this.assertQuantity(Number(item.quantity), unit, material?.name || 'an item');
      return { ...item, unit };
    });
  }

  assertQuantity(quantity: number, unit: string | null | undefined, what: string): void {
    const problem = quantityProblem(quantity, unit, what);
    if (problem) throw new BadRequestException(problem);
  }
}

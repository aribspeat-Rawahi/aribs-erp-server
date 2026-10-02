import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

// One row = "to make 1 unit of this finished good, you need this much
// of this raw material". A finished good will have several BOM rows
// (one per raw material it needs).
@Entity('bill_of_materials')
export class BillOfMaterial {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  finishedGoodId: string;

  @Column()
  rawMaterialId: string;

  // Quantity of the raw material needed per 1 unit of finished good.
  @Column('decimal', { precision: 12, scale: 4 })
  quantityPerUnit: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

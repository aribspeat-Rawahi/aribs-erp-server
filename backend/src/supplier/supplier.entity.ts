import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

// Oman VAT position of the supplier - decides the default VAT on its
// purchase orders: registered 5%, not registered / foreign 0% (imports
// are taxed at customs, not on the supplier's invoice).
export enum SupplierVatStatus {
  REGISTERED = 'registered',
  NOT_REGISTERED = 'not_registered',
  FOREIGN = 'foreign',
}

@Entity('suppliers')
export class Supplier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  contactPerson: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  address: string;

  // Supplier's Oman VAT number (VATIN) - needed to claim input VAT.
  @Column({ type: 'varchar', length: 30, nullable: true })
  vatin: string | null;

  @Column({ type: 'enum', enum: SupplierVatStatus, default: SupplierVatStatus.REGISTERED })
  vatStatus: SupplierVatStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

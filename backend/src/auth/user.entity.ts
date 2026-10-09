import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ModulePermissions } from './module-permissions';

// Roles map directly to the people/functions mentioned across the ERP:
// CEO/MD need visibility + VAT-exclude notices, Accountant handles
// invoices/accounting, Production handles manufacturing, Sales handles
// orders/quotations. Admin has full access.
export enum UserRole {
  ADMIN = 'admin',
  CEO = 'ceo',
  MD = 'md',
  ACCOUNTANT = 'accountant',
  PRODUCTION = 'production',
  SALES = 'sales',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column()
  passwordHash: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.SALES })
  role: UserRole;

  @Column({ default: true })
  active: boolean;

  // Per-module access overrides (Phase 1 — menu/page-level only, see
  // module-permissions.ts). Null/empty = no overrides, this user's menu
  // visibility is exactly the existing role-based rule (nothing changes
  // for any account until an Admin/CEO/MD explicitly sets something
  // here). A module present in this map with a level of 'none' hides
  // that module even if the role would normally show it; any other
  // level shows it even if the role normally wouldn't.
  @Column({ type: 'simple-json', nullable: true })
  modulePermissions: ModulePermissions | null;

  // Soft delete — "Delete" from the Team page only hides the account from
  // the normal list and blocks login; it never touches this row or any
  // history the user created (invoices, journal entries, etc. keep their
  // loose createdBy id/email exactly as before). Set back to null to
  // "recall"/undo the delete. Null = not deleted (the normal case).
  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  // Set whenever the password changes: sign-ins (tokens) issued before it
  // stop working, so a reset really locks out whoever knew the old one.
  @Column({ type: 'datetime', nullable: true })
  passwordChangedAt: Date | null;

  // "Forgot password" link: only a SHA-256 hash of the emailed token is
  // kept, valid until resetTokenExpiresAt, usable once.
  @Column({ type: 'varchar', length: 64, nullable: true, select: false })
  resetTokenHash: string | null;

  @Column({ type: 'datetime', nullable: true, select: false })
  resetTokenExpiresAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

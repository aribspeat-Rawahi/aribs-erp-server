import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// A lightweight project/task log (name, start date, members, tags,
// active status). `members` and `tags` are free-text/comma-separated for
// now — not a real relation to Employee, same "standalone step" approach
// as the other new HR sections until everything is wired together.
@Entity('hr_projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'date', nullable: true })
  startedOn: string;

  // Comma-separated free-text names for now (e.g. "Store Manager,
  // Accountant") — not linked to real Employee rows yet.
  @Column({ nullable: true })
  members: string;

  // Comma-separated free-text tags (e.g. "urgent, demo").
  @Column({ nullable: true })
  tags: string;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}

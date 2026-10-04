import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { RecurringInvoice, RecurringFrequency } from './recurring-invoice.entity';
import { CreateRecurringInvoiceDto, UpdateRecurringInvoiceDto } from './dto/recurring-invoice.dto';
import { CustomerService } from '../customer/customer.service';
import { InvoiceService } from '../invoice/invoice.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { CreateInvoiceDto } from '../invoice/dto/invoice.dto';

@Injectable()
export class RecurringInvoiceService {
  private readonly logger = new Logger(RecurringInvoiceService.name);

  constructor(
    @InjectRepository(RecurringInvoice)
    private repo: Repository<RecurringInvoice>,
    private customerService: CustomerService,
    // One-directional — same pattern as QuotationService's dependency on
    // InvoiceService (convertToInvoice). No cycle: InvoiceModule never
    // imports RecurringInvoiceModule.
    private invoiceService: InvoiceService,
    private activityLog: ActivityLogService,
    private config: ConfigService,
  ) {}

  private todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  private addDays(dateStr: string, days: number) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // Adds `months` months to `dateStr`, preserving the original
  // day-of-month by clamping to the last valid day of the resulting
  // month instead of letting Date auto-roll (e.g. Jan 31 + 1 month would
  // otherwise roll over to Mar 3 instead of landing on Feb 28/29).
  private addMonthsClamped(dateStr: string, months: number): string {
    const d = new Date(dateStr);
    const originalDay = d.getDate();
    d.setDate(1); // avoid rollover while adding months
    d.setMonth(d.getMonth() + months);
    const daysInTargetMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(originalDay, daysInTargetMonth));
    return d.toISOString().slice(0, 10);
  }

  private advance(dateStr: string, frequency: RecurringFrequency) {
    switch (frequency) {
      case RecurringFrequency.WEEKLY:
        return this.addDays(dateStr, 7);
      case RecurringFrequency.MONTHLY:
        return this.addMonthsClamped(dateStr, 1);
      case RecurringFrequency.QUARTERLY:
        return this.addMonthsClamped(dateStr, 3);
      case RecurringFrequency.YEARLY:
        return this.addMonthsClamped(dateStr, 12);
      default:
        return dateStr;
    }
  }

  // `items` is stored as JSON text; API responses send it as a real list
  // (the edit form reads it as one).
  private toView(entity: RecurringInvoice) {
    let items: unknown = [];
    try {
      items = JSON.parse(entity.items || '[]');
    } catch {
      items = [];
    }
    return { ...entity, items };
  }

  async findAll() {
    const rows = await this.repo.find({ order: { createdAt: 'DESC' } });
    return rows.map((r) => this.toView(r));
  }

  async findOneView(id: string) {
    return this.toView(await this.findOne(id));
  }

  async findOne(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Recurring invoice not found');
    return item;
  }

  async create(dto: CreateRecurringInvoiceDto, createdByEmail?: string) {
    await this.customerService.findOne(dto.customerId); // 404s if the customer doesn't exist
    const item = this.repo.create({
      customerId: dto.customerId,
      label: dto.label,
      items: JSON.stringify(dto.items),
      discountAmount: dto.discountAmount ?? 0,
      paymentType: dto.paymentType,
      deliveryMethod: dto.deliveryMethod,
      template: dto.template,
      vatExcluded: dto.vatExcluded,
      dueDays: dto.dueDays,
      frequency: dto.frequency,
      startDate: dto.startDate,
      nextRunDate: dto.startDate,
      endDate: dto.endDate,
      active: true,
      createdByEmail,
    });
    return this.toView(await this.repo.save(item));
  }

  async update(id: string, dto: UpdateRecurringInvoiceDto) {
    const item = await this.findOne(id);
    if (dto.customerId !== undefined) {
      await this.customerService.findOne(dto.customerId);
      item.customerId = dto.customerId;
    }
    if (dto.label !== undefined) item.label = dto.label;
    if (dto.items !== undefined) item.items = JSON.stringify(dto.items);
    if (dto.discountAmount !== undefined) item.discountAmount = dto.discountAmount;
    if (dto.paymentType !== undefined) item.paymentType = dto.paymentType;
    if (dto.deliveryMethod !== undefined) item.deliveryMethod = dto.deliveryMethod;
    if (dto.template !== undefined) item.template = dto.template;
    if (dto.vatExcluded !== undefined) item.vatExcluded = dto.vatExcluded;
    if (dto.dueDays !== undefined) item.dueDays = dto.dueDays;
    if (dto.frequency !== undefined) item.frequency = dto.frequency;
    if (dto.nextRunDate !== undefined) item.nextRunDate = dto.nextRunDate;
    if (dto.endDate !== undefined) item.endDate = dto.endDate;
    if (dto.active !== undefined) item.active = dto.active;
    return this.toView(await this.repo.save(item));
  }

  async remove(id: string) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true };
  }

  // Replays this template through InvoiceService.create() exactly like a
  // manually entered invoice — including the CRM Step 7 approval gates.
  // A gate that blocks doesn't fail the run: it's automatically
  // re-submitted with requestApproval:true, so it shows up on the
  // Approvals dashboard instead of silently never generating.
  private async generateInvoiceFor(item: RecurringInvoice) {
    const dto: CreateInvoiceDto = {
      customerId: item.customerId,
      items: JSON.parse(item.items),
      discountAmount: Number(item.discountAmount || 0),
      paymentType: item.paymentType,
      deliveryMethod: item.deliveryMethod,
      template: item.template,
      vatExcluded: item.vatExcluded,
      dueDate: item.dueDays != null ? this.addDays(this.todayStr(), item.dueDays) : undefined,
    };
    const requestedBy = { email: 'recurring-invoice-automation' };
    try {
      return await this.invoiceService.create(dto, { requestedBy });
    } catch (err) {
      if (err instanceof BadRequestException) {
        const response = err.getResponse();
        if (typeof response === 'object' && response && (response as any).approvalRequired) {
          return this.invoiceService.create({ ...dto, requestApproval: true }, { requestedBy });
        }
      }
      throw err;
    }
  }

  // Runs the given template right now, regardless of nextRunDate — for
  // an immediate one-off need, or to test a newly created template. Still
  // advances nextRunDate the same way the daily cron would, so the next
  // scheduled run isn't a duplicate of this one.
  async generateNow(id: string) {
    const item = await this.findOne(id);
    const result = await this.generateInvoiceFor(item);
    await this.advanceAfterRun(item, result);
    return result;
  }

  private async advanceAfterRun(item: RecurringInvoice, result: any) {
    item.lastRunAt = this.todayStr();
    if (result && !result.pendingApproval) {
      item.lastGeneratedInvoiceId = result.id;
    }
    const next = this.advance(item.nextRunDate, item.frequency);
    if (item.endDate && next > item.endDate) {
      item.active = false;
    } else {
      item.nextRunDate = next;
    }
    await this.repo.save(item);
    await this.activityLog.log({
      action: 'recurring_invoice.generated',
      entityType: 'recurring_invoice',
      entityId: item.id,
      details: {
        label: item.label,
        customerId: item.customerId,
        pendingApproval: !!result?.pendingApproval,
        invoiceId: result?.id,
      },
    });
  }

  @Cron('0 6 * * *')
  async runDailyGeneration() {
    if (String(this.config.get('RECURRING_INVOICE_ENABLED')).toLowerCase() === 'false') return;

    const today = this.todayStr();
    const due = await this.repo
      .createQueryBuilder('ri')
      .where('ri.active = :active', { active: true })
      .andWhere('ri.nextRunDate <= :today', { today })
      .getMany();

    let generated = 0;
    for (const item of due) {
      try {
        const result = await this.generateInvoiceFor(item);
        await this.advanceAfterRun(item, result);
        generated++;
      } catch (err) {
        this.logger.error(`Recurring invoice generation failed for ${item.id} (${item.label}): ${(err as Error).message}`);
      }
    }
    this.logger.log(`Recurring invoice run: ${generated}/${due.length} generated.`);
  }
}

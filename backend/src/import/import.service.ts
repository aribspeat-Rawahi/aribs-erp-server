import { BadRequestException, Injectable } from '@nestjs/common';
import { JournalPostingService } from '../journal/journal-posting.service';
import { booksStarted } from '../inventory/stock-journal.util';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { Customer } from '../customer/customer.entity';
import { CustomerBankAccount } from '../customer/customer-bank-account.entity';
import { Supplier } from '../supplier/supplier.entity';
import { SupplierBankAccount } from '../supplier/supplier-bank-account.entity';
import { FinishedGood } from '../inventory/finished-good.entity';
import { RawMaterial } from '../inventory/raw-material.entity';
import { BatchTrackingService } from '../inventory/batch-tracking.service';
import { BatchSource } from '../inventory/batch-source.enum';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { parseUnit, quantityProblem } from '../units/units';
import { IMPORT_DEFINITIONS, ImportColumn, ImportType, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, headerKey } from './import-columns';

export interface UploadedSheet {
  originalname: string;
  buffer: Buffer;
  size: number;
}

export type RowStatus = 'ok' | 'duplicate' | 'error';

export interface PreviewRow {
  row: number; // row number in the file (header = 1)
  status: RowStatus;
  messages: string[];
  cells: Record<string, string>; // header -> value as typed in the file
  values: Record<string, unknown>; // cleaned values (internal)
}

interface Actor {
  userId?: string;
  email?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class ImportService {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private batchTracking: BatchTrackingService,
    private activityLog: ActivityLogService,
    private journal: JournalPostingService,
  ) {}

  // ---- template -------------------------------------------------------------

  async buildTemplate(type: ImportType): Promise<Buffer> {
    const def = IMPORT_DEFINITIONS[type];
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ARIBS ERP';
    const sheet = wb.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = def.columns.map((c) => ({ header: c.header, key: c.key, width: Math.max(14, c.header.length + 4) }));
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FF1F2937' } };
    def.columns.forEach((c, i) => {
      const cell = header.getCell(i + 1);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.required ? 'FFFDE68A' : 'FFE5E7EB' } };
      if (c.help || c.required) cell.note = `${c.required ? 'Required. ' : ''}${c.help || ''}`.trim();
      const col = sheet.getColumn(i + 1);
      // codes/phones as Text so Excel keeps leading zeros and long numbers
      if (c.kind === 'code') col.numFmt = '@';
      for (let r = 2; r <= MAX_IMPORT_ROWS + 1; r++) {
        if (c.kind === 'unit') {
          sheet.getCell(r, i + 1).dataValidation = {
            type: 'list',
            allowBlank: false,
            formulae: ['"Pcs,Bags,Kgs,Litre,Tons"'],
            showErrorMessage: true,
            errorTitle: 'Unit',
            error: 'Choose Pcs, Bags, Kgs, Litre or Tons.',
          };
        } else if (c.kind === 'yesno') {
          sheet.getCell(r, i + 1).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Yes,No"'] };
        } else if (c.kind === 'code') {
          sheet.getCell(r, i + 1).numFmt = '@';
        }
      }
    });

    const help = wb.addWorksheet('Help');
    help.columns = [
      { header: 'Column', key: 'h', width: 24 },
      { header: 'Required', key: 'r', width: 10 },
      { header: 'Rules', key: 'n', width: 70 },
      { header: 'Example', key: 'e', width: 32 },
    ];
    help.getRow(1).font = { bold: true };
    for (const c of def.columns) help.addRow({ h: c.header, r: c.required ? 'Yes' : '', n: c.help || '', e: c.example });
    help.addRow({});
    help.addRow({ h: 'How to use', n: `Fill the "Data" sheet (one ${def.label.toLowerCase().replace(/s$/, '')} per row, keep the header row), save, then upload it in the ERP.` });
    help.addRow({ n: `Up to ${MAX_IMPORT_ROWS} rows per file. Records that already exist are skipped, nothing is overwritten.` });
    help.addRow({ n: 'You can also save the Data sheet as CSV (UTF-8) and upload that.' });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ---- reading the file ------------------------------------------------------

  private cellText(v: ExcelJS.CellValue): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(Math.round(v * 1e6) / 1e6);
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'object') {
      const o = v as unknown as Record<string, unknown>;
      if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join('');
      if ('result' in o) return this.cellText(o.result as ExcelJS.CellValue);
      if ('text' in o) return String(o.text ?? '');
      if ('error' in o) return '';
    }
    return String(v);
  }

  // Small RFC 4180 CSV reader (quotes, "" escapes, CRLF), delimiter
  // guessed from the header line (Excel uses ";" in some locales).
  private parseCsv(text: string): string[][] {
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const);
    const delim = counts.sort((a, b) => b[1] - a[1])[0][0];
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i++;
          } else quoted = false;
        } else cell += ch;
      } else if (ch === '"' && cell === '') quoted = true;
      else if (ch === delim) {
        row.push(cell);
        cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }

  async readGrid(file: UploadedSheet, maxRows = MAX_IMPORT_ROWS, maxBytes = MAX_IMPORT_BYTES): Promise<string[][]> {
    if (!file?.buffer?.length) throw new BadRequestException('Choose a file to upload.');
    if (file.size > maxBytes) throw new BadRequestException(`The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    const name = (file.originalname || '').toLowerCase();
    if (name.endsWith('.csv')) {
      return this.parseCsv(file.buffer.toString('utf8').replace(/^﻿/, ''));
    }
    if (!name.endsWith('.xlsx')) throw new BadRequestException('Upload an Excel (.xlsx) or CSV (.csv) file.');
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as any);
    } catch {
      throw new BadRequestException('This file could not be read as an Excel (.xlsx) file.');
    }
    const sheet = wb.getWorksheet('Data') || wb.worksheets.find((w) => w.name.toLowerCase() !== 'help' && w.actualRowCount > 0);
    if (!sheet) throw new BadRequestException('The file has no data sheet.');
    const grid: string[][] = [];
    const width = sheet.columnCount;
    sheet.eachRow({ includeEmpty: true }, (r, n) => {
      if (n > maxRows + 50) return;
      const cells: string[] = [];
      for (let c = 1; c <= width; c++) cells.push(this.cellText(r.getCell(c).value));
      grid[n - 1] = cells;
    });
    return Array.from(grid, (r) => r || []);
  }

  // ---- validation ---------------------------------------------------------

  async preview(type: ImportType, file: UploadedSheet) {
    const def = IMPORT_DEFINITIONS[type];
    const grid = await this.readGrid(file);
    const headerIdx = grid.findIndex((r) => r.some((c) => String(c).trim() !== ''));
    if (headerIdx < 0) throw new BadRequestException('The file is empty.');
    const headers = grid[headerIdx].map((h) => String(h).trim());

    // map file columns -> definition columns
    const colIndex = new Map<string, number>();
    const ignored: string[] = [];
    headers.forEach((h, i) => {
      if (!h) return;
      const k = headerKey(h);
      const col = def.columns.find((c) => headerKey(c.header) === k || (c.aliases || []).some((a) => headerKey(a) === k));
      if (col && !colIndex.has(col.key)) colIndex.set(col.key, i);
      else ignored.push(h);
    });
    const missing = def.columns.filter((c) => c.required && !colIndex.has(c.key)).map((c) => c.header);
    const booksOpen = await booksStarted(this.journal);
    if (missing.length) {
      throw new BadRequestException(`Required column(s) missing: ${missing.join(', ')}. Download the template to see the expected columns.`);
    }

    const dataRows = grid.slice(headerIdx + 1).map((cells, i) => ({ rowNumber: headerIdx + i + 2, cells }));
    const nonEmpty = dataRows.filter((r) => r.cells.some((c) => String(c ?? '').trim() !== ''));
    if (!nonEmpty.length) throw new BadRequestException('The file has a header row but no data rows.');
    if (nonEmpty.length > MAX_IMPORT_ROWS) throw new BadRequestException(`Too many rows (${nonEmpty.length}). Up to ${MAX_IMPORT_ROWS} per file - split it into several files.`);

    const existing = await this.loadExisting(type);
    const seen = new Map<string, number>(); // duplicate key -> first row
    const rows: PreviewRow[] = [];

    for (const r of nonEmpty) {
      const messages: string[] = [];
      const values: Record<string, unknown> = {};
      const cells: Record<string, string> = {};
      for (const col of def.columns) {
        const idx = colIndex.get(col.key);
        const raw = idx === undefined ? '' : String(r.cells[idx] ?? '').trim();
        cells[col.header] = raw;
        const { value, error } = this.cleanValue(col, raw);
        if (error) messages.push(error);
        else values[col.key] = value;
      }

      // opening stock must fit the unit
      const qty = values.quantityInStock as number | undefined;
      // once the books have started, stock only comes in through flows that post to the ledger
      if (qty && qty > 0 && booksOpen) {
        messages.push('Opening Stock can only be imported before the opening balances are finalized - leave it empty and use Add stock / a purchase order.');
      }
      if (qty && values.unit) {
        const problem = quantityProblem(qty, values.unit as string, 'Opening Stock');
        if (problem) messages.push(problem.replace('Quantity for Opening Stock', 'Opening Stock'));
      }
      if (type === 'raw-materials' && values.supplierName) {
        const sid = existing.supplierIds.get(String(values.supplierName).toLowerCase());
        if (!sid) messages.push(`Supplier "${values.supplierName}" not found - add or import the supplier first.`);
        else values.supplierId = sid;
      }

      let status: RowStatus = messages.length ? 'error' : 'ok';
      if (status === 'ok') {
        for (const key of this.duplicateKeys(type, values)) {
          if (existing.keys.has(key)) {
            status = 'duplicate';
            messages.push(`Already exists (${this.describeKey(key)}) - will be skipped.`);
            break;
          }
          const first = seen.get(key);
          if (first) {
            status = 'duplicate';
            messages.push(`Same ${this.describeKey(key)} as row ${first} in this file - will be skipped.`);
            break;
          }
        }
        if (status === 'ok') for (const key of this.duplicateKeys(type, values)) seen.set(key, r.rowNumber);
      }
      rows.push({ row: r.rowNumber, status, messages, cells, values });
    }

    const counts = {
      total: rows.length,
      ok: rows.filter((r) => r.status === 'ok').length,
      duplicate: rows.filter((r) => r.status === 'duplicate').length,
      error: rows.filter((r) => r.status === 'error').length,
    };
    return { type, label: def.label, headers: def.columns.map((c) => c.header), ignoredColumns: ignored, counts, rows };
  }

  private cleanValue(col: ImportColumn, raw: string): { value?: unknown; error?: string } {
    if (raw === '') {
      if (col.required) return { error: `${col.header} is required.` };
      return { value: undefined };
    }
    const max = col.maxLength || 255;
    switch (col.kind) {
      case 'text':
      case 'code':
        if (raw.length > max) return { error: `${col.header} is too long (max ${max} characters).` };
        return { value: col.kind === 'code' ? raw.replace(/\s+/g, col.key === 'phone' ? '' : ' ') : raw.replace(/\s+/g, ' ') };
      case 'email':
        if (!EMAIL_RE.test(raw) || raw.length > max) return { error: `${col.header} "${raw}" is not a valid email.` };
        return { value: raw.toLowerCase() };
      case 'yesno': {
        const v = raw.toLowerCase();
        if (['yes', 'y', 'true', '1'].includes(v)) return { value: true };
        if (['no', 'n', 'false', '0'].includes(v)) return { value: false };
        return { error: `${col.header} must be Yes or No (got "${raw}").` };
      }
      case 'unit': {
        const u = parseUnit(raw);
        if (!u) return { error: `Unit "${raw}" is not recognised - use Pcs, Bags, Kgs, Litre or Tons.` };
        return { value: u };
      }
      case 'number':
      case 'percent': {
        const n = Number(raw.replace(/,/g, '').replace(/omr/i, '').replace(/%$/, '').trim());
        if (!Number.isFinite(n) || n < 0) return { error: `${col.header} must be a number of 0 or more (got "${raw}").` };
        if (col.kind === 'percent' && n > 100) return { error: `${col.header} must be between 0 and 100.` };
        if (n > 1e9) return { error: `${col.header} is too large.` };
        return { value: Math.round(n * 1000) / 1000 };
      }
    }
  }

  // ---- duplicates -------------------------------------------------------

  private duplicateKeys(type: ImportType, v: Record<string, unknown>): string[] {
    const keys: string[] = [];
    const lower = (x: unknown) => String(x).trim().toLowerCase();
    if (type === 'customers' || type === 'suppliers' || type === 'raw-materials') if (v.name) keys.push(`name:${lower(v.name)}`);
    if (type === 'customers') {
      if (v.vatin) keys.push(`vatin:${lower(v.vatin)}`);
      if (v.crNumber) keys.push(`cr:${lower(v.crNumber)}`);
    }
    if (type === 'finished-goods' || type === 'raw-materials') {
      if (v.barcode) keys.push(`barcode:${lower(v.barcode)}`);
      if (v.sku) keys.push(`sku:${lower(v.sku)}`);
    }
    return keys;
  }

  private describeKey(key: string) {
    const [k, ...rest] = key.split(':');
    const label = { name: 'name', vatin: 'VATIN', cr: 'CR number', barcode: 'barcode', sku: 'SKU' }[k] || k;
    return `${label} "${rest.join(':')}"`;
  }

  private async loadExisting(type: ImportType) {
    const keys = new Set<string>();
    const supplierIds = new Map<string, string>();
    const m = this.dataSource.manager;
    const add = (prefix: string, v?: string | null) => {
      if (v && String(v).trim()) keys.add(`${prefix}:${String(v).trim().toLowerCase()}`);
    };
    if (type === 'customers') {
      for (const c of await m.find(Customer, { select: { name: true, vatin: true, crNumber: true } })) {
        add('name', c.name);
        add('vatin', c.vatin);
        add('cr', c.crNumber);
      }
    } else if (type === 'suppliers') {
      for (const s of await m.find(Supplier, { select: { name: true } })) add('name', s.name);
    } else if (type === 'finished-goods') {
      for (const g of await m.find(FinishedGood, { select: { barcode: true, sku: true } })) {
        add('barcode', g.barcode);
        add('sku', g.sku);
      }
    } else {
      for (const r of await m.find(RawMaterial, { select: { name: true, barcode: true, sku: true } })) {
        add('name', r.name);
        add('barcode', r.barcode);
        add('sku', r.sku);
      }
      for (const s of await m.find(Supplier, { select: { id: true, name: true } })) {
        if (!supplierIds.has(s.name.trim().toLowerCase())) supplierIds.set(s.name.trim().toLowerCase(), s.id);
      }
    }
    return { keys, supplierIds };
  }

  // ---- import -------------------------------------------------------------

  // Re-reads and re-checks the uploaded file (nothing from the browser is
  // trusted), then saves every OK row in ONE transaction: either all go
  // in, or none. Duplicates are skipped; error rows block the import
  // unless skipErrors is set.
  async commit(type: ImportType, file: UploadedSheet, skipErrors: boolean, actor: Actor) {
    const def = IMPORT_DEFINITIONS[type];
    const preview = await this.preview(type, file);
    if (preview.counts.error > 0 && !skipErrors) {
      throw new BadRequestException(`${preview.counts.error} row(s) have errors. Fix the file, or choose to skip those rows.`);
    }
    const toCreate = preview.rows.filter((r) => r.status === 'ok');
    if (!toCreate.length) throw new BadRequestException('Nothing to import - every row already exists or has an error.');

    await this.dataSource.transaction(async (manager) => {
      for (const r of toCreate) await this.createOne(manager, type, r.values);
    });

    await this.activityLog.log({
      userId: actor.userId,
      userEmail: actor.email,
      action: `import.${type}`,
      entityType: 'import',
      details: {
        label: `Imported ${toCreate.length} ${def.label.toLowerCase()} from ${file.originalname}`,
        fileName: file.originalname,
        created: toCreate.length,
        skippedExisting: preview.counts.duplicate,
        skippedErrors: preview.counts.error,
      },
    });
    return { created: toCreate.length, skippedExisting: preview.counts.duplicate, skippedErrors: preview.counts.error };
  }

  private async createOne(manager: EntityManager, type: ImportType, v: Record<string, unknown>) {
    const bank = ['accountName', 'accountNumber', 'bankName', 'branchName', 'branchCode', 'swiftCode', 'iban'];
    const bankValues = Object.fromEntries(bank.filter((k) => v[k] !== undefined).map((k) => [k, v[k]]));
    const pick = (keys: string[]) => Object.fromEntries(keys.filter((k) => v[k] !== undefined).map((k) => [k, v[k]]));

    if (type === 'customers') {
      const c = await manager.save(manager.create(Customer, pick(['name', 'phone', 'email', 'address', 'crNumber', 'vatin', 'vatApplicable', 'creditLimit'])));
      if (Object.keys(bankValues).length) await manager.save(manager.create(CustomerBankAccount, { ...bankValues, customerId: c.id }));
    } else if (type === 'suppliers') {
      const s = await manager.save(manager.create(Supplier, pick(['name', 'contactPerson', 'phone', 'email', 'address'])));
      if (Object.keys(bankValues).length) await manager.save(manager.create(SupplierBankAccount, { ...bankValues, supplierId: s.id }));
    } else if (type === 'finished-goods') {
      const g = await manager.save(
        manager.create(FinishedGood, pick(['name', 'barcode', 'sku', 'unit', 'sellingPrice', 'costPerUnit', 'vatRate', 'lowStockThreshold', 'quantityInStock'])),
      );
      // opening stock becomes a traceable "Opening Balance" batch
      if (Number(g.quantityInStock) > 0) {
        await this.batchTracking.createFinishedGoodBatch(manager, { finishedGoodId: g.id, quantity: Number(g.quantityInStock), source: BatchSource.OPENING_BALANCE });
      }
    } else {
      const m = await manager.save(
        manager.create(RawMaterial, pick(['name', 'unit', 'sku', 'barcode', 'costPerUnit', 'lowStockThreshold', 'reorderQuantity', 'quantityInStock', 'supplierId'])),
      );
      if (Number(m.quantityInStock) > 0) {
        await this.batchTracking.createRawMaterialBatch(manager, {
          rawMaterialId: m.id,
          quantity: Number(m.quantityInStock),
          costPerUnit: Number(m.costPerUnit || 0),
          source: BatchSource.OPENING_BALANCE,
        });
      }
    }
  }
}

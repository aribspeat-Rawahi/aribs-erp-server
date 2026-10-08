import { IsIn, IsString } from 'class-validator';

export class RepostJournalDto {
  @IsIn(['invoice', 'invoice_cogs', 'invoice_payment', 'supplier_payment', 'expense'], {
    message: 'This document type cannot be re-posted automatically.',
  })
  sourceType: string;

  @IsString()
  sourceId: string;
}

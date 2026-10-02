import { Controller, Get, Param, Query } from '@nestjs/common';
import { BatchTrackingService } from './batch-tracking.service';

// Read-only endpoints backing the frontend's "Traceability" page. Batch
// rows themselves are only ever created/consumed as a side effect of
// Purchase Order receive(), Production Order complete(), Sales Order
// complete(), and Finished Good stock-in/out — never directly via this
// controller.
@Controller()
export class BatchTrackingController {
  constructor(private service: BatchTrackingService) {}

  @Get('raw-material-batches')
  findRawBatches(@Query('rawMaterialId') rawMaterialId?: string) {
    return this.service.findRawBatches(rawMaterialId);
  }

  @Get('raw-material-batches/:id/trace-forward')
  traceForward(@Param('id') id: string) {
    return this.service.traceForwardFromRawBatch(id);
  }

  @Get('finished-good-batches')
  findFinishedBatches(@Query('finishedGoodId') finishedGoodId?: string) {
    return this.service.findFinishedBatches(finishedGoodId);
  }

  @Get('finished-good-batches/:id/trace-backward')
  traceBackward(@Param('id') id: string) {
    return this.service.traceBackwardFromFinishedBatch(id);
  }

  @Get('finished-good-batches/:id/sales')
  salesFor(@Param('id') id: string) {
    return this.service.salesForFinishedBatch(id);
  }
}

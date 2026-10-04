import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.guard';
import { UserRole } from '../auth/user.entity';
import { BatchTrackingService } from './batch-tracking.service';
import { ModuleAccess } from '../auth/module-access.decorator';

// Read-only endpoints backing the frontend's "Traceability" page. Batch
// rows themselves are only ever created/consumed as a side effect of
// Purchase Order receive(), Production Order complete(), Sales Order
// complete(), and Finished Good stock-in/out — never directly via this
// controller.
@ModuleAccess('inventory')
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

  // Admin only: a leftover batch of a product that no longer exists.
  @Roles(UserRole.ADMIN)
  @Delete('finished-good-batches/:id')
  removeOrphan(@Param('id') id: string) {
    return this.service.removeOrphanFinishedBatch(id);
  }
}

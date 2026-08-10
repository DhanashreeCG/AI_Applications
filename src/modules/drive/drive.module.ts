import { Module } from '@nestjs/common';
import { GoogleDriveAdapterService } from './google-drive-adapter.service';

@Module({
  providers: [GoogleDriveAdapterService],
  exports: [GoogleDriveAdapterService],
})
export class DriveModule {}

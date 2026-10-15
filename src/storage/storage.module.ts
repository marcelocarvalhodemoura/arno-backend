import { Global, Module } from '@nestjs/common';
import { FILE_STORAGE } from './file-storage';
import { s3FileStorage } from './s3';

@Global()
@Module({
  providers: [{ provide: FILE_STORAGE, useValue: s3FileStorage }],
  exports: [FILE_STORAGE],
})
export class StorageModule {}

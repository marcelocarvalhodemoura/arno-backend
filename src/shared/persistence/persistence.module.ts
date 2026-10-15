import { Global, Module } from '@nestjs/common';
import { UnitOfWork, unitOfWork } from './unit-of-work';

@Global()
@Module({
  providers: [{ provide: UnitOfWork, useValue: unitOfWork }],
  exports: [UnitOfWork],
})
export class PersistenceModule {}

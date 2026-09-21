import { Module } from '@nestjs/common';
import { AuthModule } from './shared/auth/auth.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
import { CatalogModule } from './catalog/catalog.module';
import { MembersModule } from './members/members.module';
import { LedgerModule } from './ledger/ledger.module';
import { ReportsModule } from './reports/reports.module';
import { ProjectsModule } from './projects/projects.module';
import { MensalidadesModule } from './mensalidades/mensalidades.module';
import { StatementModule } from './statement/statement.module';
import { BankingModule } from './banking/banking.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    AuthModule,
    HealthModule,
    IdentityModule,
    CatalogModule,
    MembersModule,
    LedgerModule,
    ReportsModule,
    ProjectsModule,
    MensalidadesModule,
    StatementModule,
    BankingModule,
    NotificationsModule,
  ],
})
export class AppModule {}

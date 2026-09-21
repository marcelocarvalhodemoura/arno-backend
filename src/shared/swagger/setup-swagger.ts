import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SWAGGER_BEARER } from './api-auth.decorator';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Tesouraria Arno')
    .setDescription(
      'API NestJS da tesouraria do Grupo Escoteiro Arno Friedrich (43/RS).\n\n' +
        '1. `POST /api/auth/login` devolve um token HMAC (12h).\n' +
        '2. Clique em **Authorize** e cole `Bearer <token>`.\n' +
        '3. Rotas de webhook (Sicredi e WhatsApp) são públicas e autenticam por token de query.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token devolvido por POST /api/auth/login',
      },
      SWAGGER_BEARER,
    )
    .addTag('Saúde e autenticação', 'Health check público, login e sessão.')
    .addTag('Usuários', 'Cadastro de administradores e tesoureiros. Exclusivo do perfil admin.')
    .addTag('Catálogo', 'Configurações, tipos de movimentação, taxas e metadados de ramos.')
    .addTag('Associados', 'Cadastro, responsáveis, contas de pagamento e importação em lote.')
    .addTag('Fluxo de caixa', 'Lançamentos manuais, conciliação e rateio.')
    .addTag('Painel e relatórios', 'Dashboard, fluxo de caixa e relatório fiscal.')
    .addTag('Projetos', 'Orçamento planejado × realizado. Criação e edição só para admin.')
    .addTag('Mensalidades', 'Grade mar–dez, cobrança e comprovante.')
    .addTag('Extrato', 'Leitura de CSV/PDF, mapeamento de colunas e ingestão.')
    .addTag('Sicredi Pix', 'Consulta, sincronização, simulação e webhook Pix.')
    .addTag('Notificações', 'Status dos canais, log de disparos e webhook da Meta.')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true, docExpansion: 'list' },
    jsonDocumentUrl: 'api/docs-json',
  });
}

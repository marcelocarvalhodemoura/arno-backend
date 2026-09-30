/**
 * Envia um e-mail de teste do lembrete de vencimento (dia 10) com o cartaz de valores.
 *
 * Uso (na pasta arno-backend):
 *   node --env-file=.env -r ts-node/register/transpile-only scripts/send-due-reminder-test.ts [destinatario]
 */
import { composeDueReminderMessage } from '../src/notifications/templates';
import { mailConfigured, resetMailTransport, sendMail } from '../src/notifications/mail';

async function main() {
  const to = process.argv[2] || process.env.MAIL_TEST_TO || 'marcelo@devwev.com.br';

  if (!mailConfigured()) {
    console.error('E-mail não configurado (MAIL_HOST / MAIL_FROM).');
    process.exit(1);
  }

  const now = new Date();
  const message = composeDueReminderMessage({
    who: 'Marcelo Carvalho',
    dueDay: 10,
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  });

  console.log(`Enviando lembrete de teste para ${to}…`);
  const result = await sendMail(to, `[TESTE] ${message.subject}`, message.text, message.html);
  resetMailTransport();

  if (!result.ok) {
    console.error('Falha:', result.error || 'desconhecida', result.skipped ? '(skipped)' : '');
    process.exit(1);
  }
  console.log('OK — e-mail enviado.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

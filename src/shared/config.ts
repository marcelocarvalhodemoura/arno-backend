/**
 * Único ponto de leitura das variáveis de ambiente. Os valores são lidos na hora (getters), então testes que
 * mudam `process.env` continuam funcionando; o resto do código lê `appConfig.<grupo>.<campo>`.
 * Não carrega o .env sozinho: quem faz isso são os pontos de entrada (`main.ts`, `shared/db.ts`), como antes.
 */
const env = (key: string): string => process.env[key]?.trim() ?? '';
const flag = (key: string): boolean => env(key) === '1' || env(key) === 'true';
const num = (key: string, fallback: number): number => {
  const raw = env(key);
  return raw ? Number(raw) : fallback;
};
const url = (key: string, fallback = ''): string => (env(key) || fallback).replace(/\/$/, '');
const list = (key: string): string[] =>
  env(key)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const DEFAULT_AUTH_SECRET = 'arno-friedrich-tesouraria-2026';

export class AppConfig {
  get nodeEnv() {
    return env('NODE_ENV');
  }
  get isProduction() {
    return this.nodeEnv === 'production';
  }
  get isDevelopment() {
    return this.nodeEnv === 'development';
  }
  /** Rodando no Vitest/Jest de unidade: sem filas em segundo plano nem IA. */
  get isUnitTest() {
    return Boolean(process.env.VITEST);
  }
  get port() {
    return num('PORT', 4000);
  }
  get publicUrl() {
    return url('PUBLIC_URL');
  }
  get databaseUrl() {
    return process.env.DATABASE_URL ?? '';
  }
  get authSecret() {
    return process.env.AUTH_SECRET ?? DEFAULT_AUTH_SECRET;
  }
  get groupCnpj() {
    return process.env.GROUP_CNPJ ?? '';
  }

  readonly admin = {
    get user() {
      return process.env.ADMIN_USER ?? 'tesouraria';
    },
    get password() {
      return process.env.ADMIN_PASSWORD ?? '';
    },
    get superadminUsers() {
      return list('SUPERADMIN_USERS');
    },
  };

  readonly mail = {
    get mock() {
      return env('MAIL_MOCK') === '1';
    },
    get host() {
      return env('MAIL_HOST');
    },
    get from() {
      return env('MAIL_FROM');
    },
    get port() {
      return num('MAIL_PORT', 587);
    },
    get secure() {
      return env('MAIL_SECURE') === '1';
    },
    get user() {
      return process.env.MAIL_USER ?? '';
    },
    get pass() {
      return process.env.MAIL_PASS ?? '';
    },
  };

  readonly outbox = {
    get concurrency() {
      return num('MAIL_QUEUE_CONCURRENCY', 3);
    },
    get maxAttempts() {
      return num('MAIL_QUEUE_MAX_ATTEMPTS', 5);
    },
    get pollMs() {
      return num('MAIL_QUEUE_POLL_MS', 1500);
    },
    get sendGapMs() {
      return num('MAIL_SEND_GAP_MS', 150);
    },
  };

  readonly whatsapp = {
    /** Mock do WhatsApp; MAIL_MOCK também liga (ambiente de teste). */
    get mock() {
      return env('WHATSAPP_MOCK') === '1' || env('MAIL_MOCK') === '1';
    },
    get token() {
      return env('WHATSAPP_TOKEN');
    },
    get phoneNumberId() {
      return env('WHATSAPP_PHONE_NUMBER_ID');
    },
    get businessAccountId() {
      return env('WHATSAPP_BUSINESS_ACCOUNT_ID');
    },
    get verifyToken() {
      return env('WHATSAPP_VERIFY_TOKEN');
    },
    get financeNumber() {
      return env('WHATSAPP_FINANCE_NUMBER');
    },
    get allowedSenders() {
      return list('WHATSAPP_ALLOWED_SENDERS');
    },
  };

  readonly sicredi = {
    get mock() {
      return flag('SICREDI_MOCK');
    },
    get clientId() {
      return env('SICREDI_CLIENT_ID');
    },
    get clientSecret() {
      return env('SICREDI_CLIENT_SECRET');
    },
    get certPath() {
      return env('SICREDI_CERT_PATH');
    },
    get keyPath() {
      return env('SICREDI_KEY_PATH');
    },
    get caPath() {
      return env('SICREDI_CA_PATH');
    },
    get pixKey() {
      return env('SICREDI_PIX_KEY');
    },
    get apiBase() {
      return (process.env.SICREDI_API_BASE ?? 'https://api-pix.sicredi.com.br/api/v2').replace(/\/$/, '');
    },
    get oauthUrl() {
      return process.env.SICREDI_OAUTH_URL ?? 'https://api-pix.sicredi.com.br/oauth/token';
    },
    get webhookToken() {
      return env('SICREDI_WEBHOOK_TOKEN');
    },
  };

  readonly pix = {
    get merchantName() {
      return process.env.PIX_MERCHANT_NAME || 'GE ARNO FRIEDRICH';
    },
    get merchantCity() {
      return process.env.PIX_MERCHANT_CITY || 'PORTO ALEGRE';
    },
  };

  readonly openai = {
    get apiKey() {
      return env('OPENAI_API_KEY');
    },
    get baseUrl() {
      return (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    },
    get model() {
      return process.env.OPENAI_MODEL || 'gpt-4o-mini';
    },
    get dailyLimit() {
      return num('AI_DAILY_LIMIT', 200);
    },
  };

  readonly s3 = {
    get bucket() {
      return env('AWS_S3_BUCKET');
    },
    get region() {
      return env('AWS_REGION') || env('AWS_DEFAULT_REGION') || 'us-east-1';
    },
  };

  /** Problemas de configuração que merecem aviso na subida. */
  warnings(): string[] {
    const found: string[] = [];
    if (!this.databaseUrl) found.push('DATABASE_URL não definida');
    if (this.isProduction && this.authSecret === DEFAULT_AUTH_SECRET) {
      found.push('AUTH_SECRET não definida em produção: os tokens usam o segredo padrão do código');
    }
    return found;
  }
}

export const appConfig = new AppConfig();

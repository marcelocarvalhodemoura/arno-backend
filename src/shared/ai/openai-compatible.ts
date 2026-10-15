import { appConfig } from '../config';
import type { LanguageModel } from './language-model';

// Qualquer provedor compatível com a API da OpenAI (OpenAI, Groq, OpenRouter, Ollama):
// basta trocar OPENAI_BASE_URL e OPENAI_MODEL no .env.

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
type ChatMessage = { role: 'system' | 'user'; content: string | ContentPart[] };

export class OpenAiCompatibleModel implements LanguageModel {
  isConfigured() {
    return Boolean(appConfig.openai.apiKey);
  }

  chatJson<T>(system: string, user: unknown, timeoutMs = 15_000): Promise<T | null> {
    return this.completeJson<T>(
      [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(user) },
      ],
      { timeoutMs },
    );
  }

  /**
   * Pergunta com texto e, opcionalmente, uma imagem (data URL). `maxTokens` baixo é obrigatório no
   * plano gratuito do Groq, que limita os tokens de resposta por minuto.
   */
  visionJson<T>(
    system: string,
    input: { text: string; imageDataUrl?: string },
    options: { timeoutMs?: number; maxTokens?: number } = {},
  ): Promise<T | null> {
    const content: ContentPart[] = [{ type: 'text', text: input.text }];
    if (input.imageDataUrl) content.push({ type: 'image_url', image_url: { url: input.imageDataUrl } });
    return this.completeJson<T>(
      [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
      { timeoutMs: options.timeoutMs ?? 30_000, maxTokens: options.maxTokens ?? 500 },
    );
  }

  private async completeJson<T>(
    messages: ChatMessage[],
    options: { timeoutMs: number; maxTokens?: number },
  ): Promise<T | null> {
    const key = appConfig.openai.apiKey;
    if (!key) return null;
    try {
      const response = await fetch(`${appConfig.openai.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: appConfig.openai.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
          messages,
        }),
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (!response.ok) {
        console.warn(`IA: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
        return null;
      }
      const payload = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const raw = payload.choices?.[0]?.message?.content ?? '{}';
      return JSON.parse(raw) as T;
    } catch (error) {
      console.warn('IA:', error instanceof Error ? error.message : error);
      return null;
    }
  }
}

/** Instância padrão, usada quando ninguém injeta outro modelo. */
export const languageModel: LanguageModel = new OpenAiCompatibleModel();

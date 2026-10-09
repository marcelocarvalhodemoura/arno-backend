/**
 * Modelo de linguagem que responde JSON. O domínio (leitura de extrato, de comprovante, mapeamento de planilha)
 * depende só desta interface; quem fala com o provedor é o adaptador em `openai-compatible.ts`.
 * Toda resposta pode ser `null` (sem chave, timeout, limite do provedor): quem chama sempre tem um caminho sem IA.
 */
export interface LanguageModel {
  isConfigured(): boolean;
  chatJson<T>(system: string, user: unknown, timeoutMs?: number): Promise<T | null>;
  visionJson<T>(
    system: string,
    input: { text: string; imageDataUrl?: string },
    options?: { timeoutMs?: number; maxTokens?: number },
  ): Promise<T | null>;
}

/** Modelo que nunca responde: útil em testes e quando a IA está desligada. */
export const noLanguageModel: LanguageModel = {
  isConfigured: () => false,
  chatJson: () => Promise.resolve(null),
  visionJson: () => Promise.resolve(null),
};

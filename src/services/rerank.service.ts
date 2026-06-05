import type { OpenAiRagClient } from './rag/openai-rag.client.js';
import type { RankedRow } from './rag/rag.types.js';

const DEFAULT_RERANK_MODEL = 'gpt-5-mini';

export class RerankService {
  constructor(
    private readonly openai: OpenAiRagClient,
    private readonly defaultModel = DEFAULT_RERANK_MODEL,
  ) {}

  async rerank(
    query: string,
    items: RankedRow[],
    keep: number,
    model = this.defaultModel,
  ): Promise<RankedRow[]> {
    if (items.length === 0) return [];
    if (items.length <= keep) return items;

    const numbered = items
      .map((it, i) => {
        const date = it.occurred_at ? ` · ${it.occurred_at}` : '';
        return `[${i + 1}] (${it.source_channel}${date})\n${it.content.slice(0, 500)}`;
      })
      .join('\n\n');

    const prompt = `Voce e um reranker. Dada a PERGUNTA, atribua uma nota de 0 a 10 a cada candidato pela relevancia. Responda APENAS com a lista numerada de notas, uma por linha, na mesma ordem dos candidatos.

PERGUNTA: ${query}

CANDIDATOS:
${numbered}

NOTAS (uma por linha, 0-10):`;

    const { content } = await this.openai.chatCompletion({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 200,
    });

    const lines = content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const scored = items.map((item, i) => {
      const line = lines[i] ?? '0';
      const m = line.match(/-?\d+(\.\d+)?/);
      const score = m ? Math.max(0, Math.min(10, parseFloat(m[0]))) : 0;
      return { item, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, keep).map((s) => ({ ...s.item, score: s.score }));
  }
}

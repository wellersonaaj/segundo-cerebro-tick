import { log } from '../utils/logger.js';
import type { OpenAiRagClient } from './rag/openai-rag.client.js';
import type { OpenTaskRow, RankedRow } from './rag/rag.types.js';

const DEFAULT_COMPOSE_MODEL = 'gpt-5-mini';
const DEFAULT_COMPOSE_MAX_TOKENS = 6000;

const LENGTH_TRUNCATED_SUFFIX = ' (continua...)';
const LENGTH_EMPTY_FALLBACK =
  'Pergunta complexa demais pra responder agora. Tenta reformular mais curto?';

export function resolveComposeContent(content: string, finish_reason?: string): string {
  const trimmed = content.trim();

  if (finish_reason === 'length') {
    log('warn', 'composer', {
      step: 'finish_reason_length',
      finish_reason,
      content_length: trimmed.length,
    });
    if (trimmed) {
      return `${trimmed}${LENGTH_TRUNCATED_SUFFIX}`;
    }
    return LENGTH_EMPTY_FALLBACK;
  }

  if (!trimmed) {
    throw new Error(`compose: empty content (finish_reason=${finish_reason ?? 'n/a'})`);
  }

  return trimmed;
}

export class ComposerService {
  constructor(
    private readonly openai: OpenAiRagClient,
    private readonly defaultModel = DEFAULT_COMPOSE_MODEL,
    private readonly maxCompletionTokens = DEFAULT_COMPOSE_MAX_TOKENS,
  ) {}

  async compose(
    query: string,
    context: RankedRow[],
    tasks: OpenTaskRow[] = [],
    model = this.defaultModel,
  ): Promise<string> {
    const sections: string[] = [];
    if (context.length > 0) {
      const ctxStr = context
        .map((c, i) => {
          const date = c.occurred_at ? ` · ${c.occurred_at}` : '';
          return `[${i + 1}] ${c.source_channel}${date}\n${c.content.slice(0, 700)}`;
        })
        .join('\n\n---\n\n');
      sections.push(`MEMORIA (capturas anteriores):\n${ctxStr}`);
    }
    if (tasks.length > 0) {
      const taskStr = tasks
        .map((t, i) => {
          const due = t.due_at_local_date ?? 'sem prazo';
          return `T${i + 1} | ${due} | ${t.title}${t.source_excerpt ? ` (${t.source_excerpt.slice(0, 80)})` : ''}`;
        })
        .join('\n');
      sections.push(
        `TAREFAS ABERTAS (cadastro direto, nao busca semantica, TOTAL: ${tasks.length}):\n${taskStr}`,
      );
    }
    if (sections.length === 0) {
      return 'Nao encontrei nada relevante na memoria sobre isso ainda.';
    }

    const prompt = `Voce e o assistente de memoria pessoal do Wellerson (conheca o usuario pelo nome). Responda em portugues, conciso e PRECISO.

REGRAS:
- Use APENAS o que esta nas secoes MEMORIA e TAREFAS ABAIXO. NAO invente, NAO complete com conhecimento geral.
- Se faltar info, diga: "Nao tenho isso na memoria ainda." NAO chute.
- Ao falar do usuario, chame-o de "Wellerson" ou "voce" (nunca "o usuario").
- Ao mencionar QUALQUER pessoa, compromisso, ou evento, USE O NOME PROPRIO (Lari, Breno, Bruno, etc). Nao substitua por pronomes como "ela", "ele" — o usuario quer ver quem.
- Se a secao TAREFAS tem items e a pergunta eh sobre tarefas/compromissos/pendentes, LISTE TODAS as tarefas da secao TAREFAS usando T1, T2 etc, em formato lista. NAO resuma, NAO escolha soh uma.
- Cite fontes [1], [2] etc para a memoria; cite "T1, T2" etc para tarefas.
- Maximo 6 frases. Direto ao ponto. Se a pergunta tem varios aspectos, cubra todos ou admita o que falta.

${sections.join('\n\n---\n\n')}

PERGUNTA: ${query}

RESPOSTA:`;

    const { content, finish_reason } = await this.openai.chatCompletion({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: this.maxCompletionTokens,
      reasoning_effort: 'low',
    });

    return resolveComposeContent(content, finish_reason);
  }
}

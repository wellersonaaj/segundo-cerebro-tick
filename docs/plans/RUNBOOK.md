# Runbook — Orquestrador Unificado (Cursor)

> **Como usar:** abre o Cursor na raiz do repo, abre o painel
> **Composer (Cmd+I)** ou **Chat (Cmd+L)**, e cola os prompts abaixo
> **na ordem**. Cada fase tem um prompt pronto.
>
> Antes de começar, certifica que:
> - [  ] `git pull origin main` (código atualizado)
> - [  ] `npm install` (deps ok)
> - [  ] `.env` configurado com `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`
> - [  ] `npm test` passa 100% (baseline)

---

## Fase 0 — Logging estruturado (já parcialmente feito)

**Status:** `src/utils/structured-logger.ts` já existe e funciona. Falta plugar nos pontos existentes.

### Prompt pro Cursor:

```
Tarefa: plugar o structured logger (src/utils/structured-logger.ts) nos
3 pontos críticos do pipeline atual. Não criar nada novo, só envolver
as chamadas existentes.

Arquivos a modificar:
1. src/api/telegram-webhook.routes.ts — na rota POST /webhooks/telegram,
   ANTES do reply.send, adicionar:
   const turn = startTurn({ turn_id: randomUUID(), user_id: capture.userId, chat_id: capture.chatId, message_id: capture.messageId, input: capture.text });
   await turn.stage('parse', { output: { kind: parsed.kind, has_capture: parsed.kind === 'capture' } });

2. src/services/telegram-inbox.service.ts — em handleIncoming:
   - Após resolver thread: turn.stage('thread_resolve', { output: { thread_id: threadId } })
   - Antes do tryResolveClarification: turn.stage('clarification_check', { output: { forced_new: forceNewCapture } })
   - Passar o `turn` handle pra frente (ou usar contexto async)

3. src/services/assistant-turn.service.ts — em startCapture:
   - Após criar o turn: turn.stage('extraction', async () => { ... envolver chamada do v14 pipeline ... })
   - Capturar output_tokens se a resposta do extractor trouxer

NÃO mexer em:
- Lógica de negócio (só adicionar logs)
- Ordem das chamadas
- Tratamento de erro (logs vão DENTRO dos catches existentes, não em volta)

Aceite:
- npm test passa 100%
- Manda 1 mensagem no Telegram
- tail -5 /tmp/cerebro-logs/$(date -u +%Y-%m-%d).jsonl | jq mostra entries com stage=parse, clarification_check, etc.
```

### Validação:

```bash
npm test
echo "---"
# manda msg no Telegram
tail -10 /tmp/cerebro-logs/$(date -u +%Y-%m-%d).jsonl | jq
```

---

## Fase 1 — Extrair RAG service

### Prompt pro Cursor:

```
Tarefa: extrair a lógica de RAG do scripts/observer-telegram-bot.ts e
transformar em services TS com DI, tipos e testes.

Arquivos a criar:
1. src/services/retrieval.service.ts
   - class RetrievalService
   - constructor(private db: ReturnType<typeof getSupabase>, private embedder: EmbedderService)
   - async retrieve(query: string, opts?: { topKInbox?: number; topKAssertions?: number; userId?: string }): Promise<{ inbox: RankedRow[]; assertions: RankedRow[]; latencyMs: number }>
   - Internamente: embed(query) → rpc('hybrid_search_inbox_items', {...}) e rpc('hybrid_search_assertions', {...})
   - Tipos RankedRow = { id, content, source_channel, occurred_at, score }

2. src/services/rerank.service.ts
   - class RerankService
   - async rerank(query: string, items: RankedRow[], keep: number, model?: string): Promise<RankedRow[]>
   - Lógica idêntica à função rerank() do observer bot

3. src/services/rag-pipeline.service.ts
   - class RAGPipelineService
   - constructor(private retrieval: RetrievalService, private rerank: RerankService, private composer: ComposerService, private verifier: VerifierService)
   - async answer(query: string, opts?: { topKInbox?: number; topKAssertions?: number; rerankKeepInbox?: number; rerankKeepAssertions?: number; openTasks?: OpenTask[] }): Promise<{ answer: string; sources: RankedRow[]; confidence: number }>
   - Pipeline: retrieve → rerank → compose → verify
   - confidence = média dos scores rerankeados

4. src/services/embedder.service.ts
   - class EmbedderService
   - async embed(text: string): Promise<number[]>
   - Usa OpenAI text-embedding-3-small (1536 dims)

5. src/services/composer.service.ts e src/services/verifier.service.ts
   - Extrair compose() e verifyCoverage() do observer pra services

Arquivos a criar (testes):
- tests/retrieval.service.test.ts
- tests/rerank.service.test.ts
- tests/rag-pipeline.service.test.ts
- tests/fixtures/rag-pipeline.fixture.json (5 casos de teste)

NÃO deletar scripts/observer-telegram-bot.ts ainda. Só importar dos novos services.

Aceite:
- npm test -- rag-pipeline retrieval rerank passa
- Código dos novos services compila sem warnings de tipo
```

### Validação:

```bash
npm test -- rag-pipeline retrieval rerank
```

---

## Fase 2 — Intent classifier

### Prompt pro Cursor:

```
Tarefa: criar um classificador de intent via LLM que decida entre
4 categorias: save, update, query, command.

Arquivo a criar:
1. src/services/intent-classifier.service.ts
   - type Intent = 'save' | 'update' | 'query' | 'command'
   - interface IntentResult { intent: Intent; confidence: number; reasoning: string; suggested_command?: string }
   - class IntentClassifierService
   - constructor(private openai: OpenAIClient, private model = 'gpt-5-mini')
   - async classify(text: string, context?: { recent_messages?: string[]; user_id?: string }): Promise<IntentResult>
   - System prompt com 8-10 few-shot examples (salvar, atualizar, perguntar, comando)
   - Resposta em JSON estruturado (response_format: { type: 'json_object' })
   - max_completion_tokens: 200
   - Se confidence < 0.5, retorna intent='save' (fallback seguro)

Few-shot examples (no system prompt):
- "marquei consulta com Breno quinta 14h" → save
- "comprei pão por 8 reais" → save
- "ideia: fazer um app de pomodoro" → save
- "na verdade era sexta, não quinta" → update
- "esquece o Breno, era com João" → update
- "o que eu tenho com Breno essa semana?" → query
- "quando foi que eu falei sobre React?" → query
- "/status" → command, suggested_command='/status'
- "/debug abc-123" → command, suggested_command='/debug'
- "Breno" → save (default quando ambíguo)

Test fixtures:
2. tests/fixtures/intent-eval.jsonl
   - 20 mensagens rotuladas (5 save, 3 update, 7 query, 3 command, 2 ambíguas)
   - Formato: { "text": "...", "expected": "save", "note": "..." }

3. tests/intent-classifier.service.test.ts
   - Mock OpenAIClient
   - Test: cada intent é classificado certo
   - Test: confidence baixa → fallback pra 'save'
   - Test: resposta do LLM malformada → fallback

4. tests/intent-classifier.eval.test.ts
   - Roda classificador real contra o fixture
   - Skip se OPENAI_API_KEY não tiver
   - Meta: ≥85% hit rate

Aceite:
- npm test -- intent-classifier passa 100% (unit)
- npm run test:intent:eval ≥85% (eval real)
```

### Validação:

```bash
npm test -- intent-classifier
OPENAI_API_KEY=sk-... npm run test:intent:eval
```

---

## Fase 3 — Command handler + Unified router

### Prompt pro Cursor:

```
Tarefa: criar o orquestrador que classifica e roteia, mais o handler
de comandos.

Arquivos a criar:
1. src/services/command-handler.service.ts
   - class CommandHandlerService
   - async handle(command: string, args: string[], ctx: { turn_id: string; chat_id: number; user_id: number }): Promise<{ text: string; parse_mode?: 'Markdown' }>
   - Comandos:
     - /status: lê logs do dia, retorna {total: N, p95_latency: Xms, cost_usd: $Y}
     - /debug [turn_id]: filtra logs por turn_id (ou último se omitido), retorna stages formatados
     - /help: lista comandos
     - /costs: retorna breakdown por stage (últimas 24h)
     - /log: últimos 20 entries (sanitizado)
   - Lê /tmp/cerebro-logs/YYYY-MM-DD.jsonl (zero infra extra)
   - Helper privado: readLogsFor(date: Date): LogEntry[]

2. src/services/unified-router.service.ts
   - class UnifiedRouterService
   - constructor(
       private classifier: IntentClassifierService,
       private assistantTurn: AssistantTurnService,
       private rag: RAGPipelineService,
       private commands: CommandHandlerService,
       private logger: StructuredLogger,
     )
   - async handle(capture: ParsedTelegramCapture): Promise<string>
   - Fluxo:
     a. const turn = startTurn({...})
     b. turn.stage('intent_classify', async () => ({ output: result, model, input_tokens, output_tokens }))
     c. turn.stage('route_dispatch', { output: { intent } })
     d. switch(intent) {
          case 'save'|'update': return assistantTurn.startCapture(...)
          case 'query': return rag.answer(...)
          case 'command': return commands.handle(...)
        }
     e. turn.finish()
   - Se INTENT_CLASSIFIER_ENABLED=false (env), pula o classificador e vai direto pra 'save'

Arquivos a modificar:
3. src/services/telegram-inbox.service.ts
   - Trocar a chamada `assistantTurn.startCapture(...)` por `unifiedRouter.handle(capture)`
   - Manter lógica de "nova:" prefix e clarification intactas
   - Adicionar turn.stage('parse') e turn.stage('thread_resolve') nos pontos existentes

4. src/app.ts
   - Construir RetrievalService, RerankService, RAGPipelineService, IntentClassifierService, CommandHandlerService, UnifiedRouterService
   - Injetar UnifiedRouter no TelegramInboxService

5. src/config/env.ts
   - Adicionar: INTENT_CLASSIFIER_ENABLED (default: true), INTENT_CLASSIFIER_MODEL (default: 'gpt-5-mini'), RAG_RETRIEVAL_TOP_K (default: 10), LOG_DIR (default: '/tmp/cerebro-logs')

6. .env.example
   - Adicionar as mesmas vars com comentários

Testes:
7. tests/unified-router.service.test.ts
   - Mock classifier pra forçar cada intent
   - Verifica que cada intent chama o handler certo
   - Verifica que tudo é logado

8. tests/command-handler.service.test.ts
   - Mock filesystem com logs fake
   - Test /status, /debug, /help, /costs, /log

Aceite:
- npm test -- unified-router command-handler passa 100%
- Manda "/status" no Telegram e responde com números reais
- Manda "marquei consulta quinta 14h" → intent_classify loga intent=save
- Manda "o que eu tenho com Breno?" → intent_classify loga intent=query, RAG responde
```

### Validação:

```bash
npm test -- unified-router command-handler
echo "---"
npm run dev   # sobe a API
echo "---"
# manda "/status" no Telegram
tail -5 /tmp/cerebro-logs/$(date -u +%Y-%m-%d).jsonl | jq
```

---

## Fase 4 — Pre-context injection

### Prompt pro Cursor:

```
Tarefa: fazer o AssistantTurn usar retrieval como pre-context antes
de chamar o extractor v14 (Caminho A).

Arquivo a modificar:
1. src/services/assistant-turn.service.ts
   - Em startCapture, ANTES de chamar this.v14Process:
     const retrieval = await turn.stage('retrieval_for_extraction', async () => {
       const result = await this.retrieval.retrieve(input.text, { topKInbox: 5, topKAssertions: 3 });
       return { output: { hits: result.inbox.length + result.assertions.length, latency: result.latencyMs } };
     });
   - Formatar resultado como contextBlock (string)
   - Passar contextBlock pro extractor v14

2. src/openai/extractor-v1.4.prompt.ts
   - Adicionar parâmetro `contextBlock?: string` em buildPrompt (ou equivalente)
   - Se contextBlock presente, injetar antes do user message

3. tests/assistant-turn.service.test.ts
   - Mock retrieval com 3 items conhecidos
   - Verifica que o prompt do extractor inclui esses items
   - Verifica que extraction ainda funciona (mock do v14)

4. scripts/run-pre-context-eval.ts
   - Cria script que:
     a. Roda N extrações SEM pre-context, mede métricas (entity resolution rate, dedup rate)
     b. Roda N extrações COM pre-context
     c. Compara
   - Salva resultado em artifacts/pre-context-eval.json

Aceite:
- npm test -- pre-context assistant-turn passa
- scripts/run-pre-context-eval mostra ganho (recall ≥baseline)
```

### Validação:

```bash
npm test -- pre-context
npx tsx scripts/run-pre-context-eval.ts
```

---

## Fase 5 — UX dos comandos

### Prompt pro Cursor:

```
Tarefa: melhorar a experiência dos comandos no Telegram.

1. /status com inline_keyboard:
   - 3 botões: "Ver custos" / "Ver últimos 5" / "Ver erros"
   - Ao clicar, edita a mensagem com o conteúdo pedido

2. /debug aceita turn_id OU último turno (se omitido)
   - Resposta formatada com markdown
   - Cada stage em código (bloco ```)

3. /costs retorna tabela por stage
   - intent_classify, retrieval, extraction, rerank, compose, send
   - Média de cost + total

4. /log retorna últimos 20 entries sanitizados
   - Remove campos sensíveis (não há, mas por segurança)
   - Formato: `{ts} | {stage} | {latency_ms}ms | {intent or ""}`

Arquivos a modificar:
- src/services/command-handler.service.ts (toda a lógica)
- src/telegram/telegram-bot.client.ts (adicionar editMessageText helper)

Testes:
- tests/command-handler.service.test.ts (atualizar)
- Manual: testar cada comando no Telegram real

Aceite:
- Todos os comandos respondem em <200ms
- Inline keyboard funciona
- Markdown renderiza certo
```

### Validação:

```bash
npm test -- command-handler
# manual: testa cada comando no Telegram
```

---

## Fase 6 — Rollout

### Prompt pro Cursor:

```
Tarefa: ligar de verdade, monitorar, ajustar.

Sequência de comandos (executar manualmente):

1. Na VM:
   cd /root/segundo-cerebro-tick
   git tag pre-orchestrator
   # Liga o classifier
   echo "INTENT_CLASSIFIER_ENABLED=true" >> .env
   npm run build
   # Restart da API (depende do setup — pm2, systemd, ou nohup)
   pm2 restart cerebro  # ou o comando equivalente

2. Manda 10 mensagens variadas no Telegram, depois:
   jq -s 'group_by(.intent) | map({intent: .[0].intent, count: length})' /tmp/cerebro-logs/$(date -u +%Y-%m-%d).jsonl
   # Confere distribuição razoável (não tudo save)

3. Desliga o observer polling:
   pkill -f observer-telegram-bot.ts
   # ou se tiver systemd: systemctl stop observer-bot

4. Monitora por 1 semana:
   - Custo diário: jq -s 'map(.cost_usd // 0) | add' /tmp/cerebro-logs/YYYY-MM-DD.jsonl
   - Erros: jq 'select(.level=="error")' /tmp/cerebro-logs/YYYY-MM-DD.jsonl | head
   - Latência p95: jq -s 'group_by(.stage) | map({stage: .[0].stage, p95: (map(.latency_ms) | sort | .[length * 0.95 | floor])})' /tmp/cerebro-logs/YYYY-MM-DD.jsonl

5. Se tudo OK depois de 7 dias:
   git tag post-orchestrator
   # Deletar ou marcar DEPRECATED o scripts/observer-telegram-bot.ts
   rm scripts/observer-telegram-bot.ts   # ou comentar tudo com DEPRECATED
   git add -A
   git commit -m "chore: remove deprecated observer-telegram-bot.ts (replaced by UnifiedRouter)"

Rollback a qualquer momento:
   # Desliga o classifier
   sed -i 's/INTENT_CLASSIFIER_ENABLED=true/INTENT_CLASSIFIER_ENABLED=false/' .env
   pm2 restart cerebro   # ou equivalente
   # Volta a comportar como antes (sempre save)
```

### Validação:

```bash
# 7 dias depois
git log --oneline --since="7 days ago"
echo "---"
# Custo total da semana
for d in $(seq 0 6); do
  date -d "$d days ago" -u +%Y-%m-%d
  jq -s 'map(.cost_usd // 0) | add' /tmp/cerebro-logs/$(date -d "$d days ago" -u +%Y-%m-%d).jsonl 2>/dev/null
done
```

---

## Atalhos comuns (cola-e-roda)

```bash
# Setup inicial
git pull origin main
npm install
npm test

# Logs ao vivo
tail -f /tmp/cerebro-logs/$(date -u +%Y-%m-%d).jsonl | jq -c '{ts, stage, latency_ms, intent: .output.intent}'

# Stats do dia
echo "Total: $(jq -s 'length' /tmp/cerebro-logs/$(date -u +%Y-%m-%d).jsonl)"
echo "Custo: \$$(jq -s 'map(.cost_usd // 0) | add' /tmp/cerebro-logs/$(date -u +%Y-%m-%d).jsonl)"
echo "Erros: $(jq -s 'map(select(.level=="error")) | length' /tmp/cerebro-logs/$(date -u +%Y-%m-%d).jsonl)"

# Distribuição de intents
jq -s 'map(select(.stage=="intent_classify") | .output.intent) | group_by(.) | map({intent: .[0], count: length})' /tmp/cerebro-logs/$(date -u +%Y-%m-%d).jsonl

# Rollback rápido
sed -i 's/INTENT_CLASSIFIER_ENABLED=true/INTENT_CLASSIFIER_ENABLED=false/' .env
pm2 restart cerebro  # ou equivalente
```

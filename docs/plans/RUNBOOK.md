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

## Fase 0 — Logging estruturado + ALS turn context

**Status parcial:** `src/utils/structured-logger.ts` já existe. Falta: ALS pra propagar turn_id, testes do logger, shim do logger antigo, e plugar nos pontos Telegram.

### Prompt pro Cursor:

```
Tarefa: completar a Fase 0 do plano de orquestrador unificado. Quatro
deliverables pequenos. Sem mudar lógica de negócio.

### 1. AsyncLocalStorage pra turn_id

Criar src/utils/turn-context.ts:
- import { AsyncLocalStorage } from 'node:async_hooks'
- type TurnCtx = { turn_id: string; user_id?: number; chat_id?: number; message_id?: number; started_at: number; handle: TurnHandle }
- const storage = new AsyncLocalStorage<TurnCtx>()
- export function runWithTurn<T>(ctx: Omit<TurnCtx, 'handle' | 'started_at'>, fn: () => Promise<T> | T): Promise<T> | T
- export function getCurrentTurn(): TurnCtx | null   // null quando fora de Telegram (testes, API)

NOTA: NÃO exportar requireCurrentTurn(). Services SEMPRE usam
getCurrentTurn() e checam null — se null, o stage loga sem turn_id
(ou cria um ad-hoc com uuid ephemeral). Razão: testes existentes
(assistant-e2e.test.ts, etc.) chamam startCapture() direto sem webhook,
e quebrar esses testes seria regressão evitável.

### 2. Testes do structured-logger

Criar tests/utils/structured-logger.test.ts (vitest). Cobrir:
- startTurn + stage com função async → registra latency_ms
- startTurn + stage com objeto estático → registra sem latency_ms
- finish acumula cost_usd somando os stages
- stage com throw → re-throw + entry level=error + error populado
- estimateCostUsd com gpt-5-mini: input 1M tokens = $0.25, output 1M = $2
- estimateCostUsd com modelo desconhecido = 0
- escrita em LOG_DIR temporário (criar dir fake, appendFile mockado,
  verificar que file contém JSON lines)

~30 linhas de teste. Sem dependência de OpenAI real.

### 3. Shim do logger antigo (migração, não coexistência)

Modificar src/utils/logger.ts pra DELEGAR ao structured-logger:
- Manter export `log(level, message, meta)` (não quebra 9 call sites)
- Internamente:
  const turn = getCurrentTurn();
  if (turn) {
    turn.handle.stage(message, { meta: { level, ...meta } });
  } else {
    // cria entry avulsa (turn_id ephemeral)
    const adHoc = startTurn({ turn_id: randomUUID(), input: message });
    adHoc.stage(message, { meta: { level, ...meta } });
    await adHoc.finish();
  }
- API correta é `turn.stage(stage, { meta: {...} })` — `meta` é uma chave
  dentro de StageOptions, não spread
- Resultado: stdout continua igual, mas agora tudo vai pro arquivo JSONL também
- O call site NÃO precisa mudar agora — migração dos 9 call sites vem depois (Fase 6+)

### 4. Plugar turn_id no pipeline Telegram (3 arquivos)

Modificar src/api/telegram-webhook.routes.ts — PADRÃO: reply.send ANTES do void runWithTurn:
  // 1. log inicial (síncrono, sem ALS)
  await logWebhookReceived({ turn_id: randomUUID(), ... });
  reply.send({ ok: true, accepted: true });

  // 2. processa em background, com ALS
  void runWithTurn({ turn_id, user_id: capture.userId, chat_id: capture.chatId, message_id: capture.messageId }, async () => {
    const turn = getCurrentTurn();
    try {
      const handled = await deps.telegramInbox.handleIncoming(capture);
      await turn?.handle.finish();
    } catch (err) {
      await logError({ turn_id, stage: 'webhook_handler', error: err });
      await turn?.handle.finish({ error: err instanceof Error ? err.message : String(err) });
    }
  });
- CRÍTICO: reply.send acontece ANTES do void runWithTurn. Telegram não
  espera o pipeline inteiro (evita timeout/retry).
- CRÍTICO: logWebhookReceived() é chamado uma vez por entrada (síncrono,
  garante que sempre aparece no JSONL mesmo se o pipeline async falhar).
- runWithTurn envolve TODA a cadeia async (handleIncoming + .then/.catch
  + finish). Toda a cadeia carrega o mesmo turn_id via ALS.

Modificar src/services/telegram-inbox.service.ts:
- Em handleIncoming, no início: const turn = getCurrentTurn() (NÃO throw se null)
- Adicionar stages: turn?.handle.stage('parse', ...), turn?.handle.stage('thread_resolve', ...), turn?.handle.stage('clarification_check', ...)
- Se turn === null (teste), skipa os stages — não quebra nada
- O tryResolveClarification agora roda dentro do contexto do turn (ou sem, em teste)

Modificar src/services/assistant-turn.service.ts:
- Em startCapture, no início: const turn = getCurrentTurn()
- Se turn existe, envolver chamada do v14 pipeline em turn.handle.stage('extraction', async () => { ... })
- Se turn === null (teste), chama v14 direto — comportamento atual preservado

NÃO mexer em:
- Lógica de negócio (só adicionar logs, sem mudar comportamento)
- Ordem das chamadas
- Tratamento de erro (logs vão DENTRO dos catches existentes, não em volta)
- O fallback null do getCurrentTurn() garante que testes que não rodam
  via webhook continuam passando sem turn_id

Aceite:
- npm test -- structured-logger passa 100% (novo)
- npm test geral passa 100% (nada quebra, incluindo assistant-e2e.test.ts)
- Manda 1 mensagem no Telegram
- tail do JSONL filtrado por message_id mostra TODAS as entries com o MESMO turn_id
- Stages esperados: webhook_received, parse, thread_resolve, clarification_check, extraction, turn_finish (~6 entries por msg)
- Webhook retorna <100ms (reply.send antes do pipeline async)

Rollback:
- git revert <commit-fase-0>
- Ou: INTENT_CLASSIFIER_ENABLED=false + shim do logger.ts vira no-op
```

### Validação:

```bash
npm test -- structured-logger
echo "---"
npm test
echo "---"
# manda 1 msg no Telegram
sleep 2
echo "--- entries dessa msg ---"
MSG_ID=<pegar do Telegram>
grep "\"message_id\":$MSG_ID" /tmp/cerebro-logs/$(date -u +%Y-%m-%d).jsonl | jq -c '{stage, turn_id, latency_ms}'
echo "--- mesmo turn_id em todas? ---"
grep "\"message_id\":$MSG_ID" /tmp/cerebro-logs/$(date -u +%Y-%m-%d).jsonl | jq -r .turn_id | sort -u
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

5. CRIAR O SCRIPT no package.json (não existe ainda):
   Em package.json, adicionar:
   "test:intent:eval": "tsx tests/intent-classifier.eval.test.ts"
   (criar nesta fase, junto com o script — não referenciar antes de existir)

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
Tarefa: criar o orquestrador (intent → rota) e o handler de comandos.
Inclui o wiring do intent 'update' pra modo de correção.

### Arquivos a criar:

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
     )
   - async handle(capture: ParsedTelegramCapture): Promise<string>
   - Fluxo:
     a. const ctx = getCurrentTurn()   // ALS da Fase 0 — pode ser null
     b. if (ctx) await ctx.handle.stage('intent_classify', async () => ({ output: result, model, input_tokens, output_tokens }))
        else log estruturado avulso (turn_id ephemeral)
     c. if (ctx) await ctx.handle.stage('route_dispatch', { output: { intent: result.intent } })
     d. switch(result.intent) {
          case 'save':    return this.assistantTurn.startCapture({ ..., mode: 'capture' })
          case 'update':  return this.assistantTurn.startCapture({ ..., mode: 'correction' })
          case 'query':   return this.rag.answer(...)
          case 'command': return this.commands.handle(...)
        }
   - Se INTENT_CLASSIFIER_ENABLED=false (env), pula o classificador e assume 'save'

### Arquivos a modificar (WIRING DO INTENT 'update'):

3. src/services/assistant-turn.service.ts (e types em assistant-turn.types.ts)
   - Adicionar campo `mode?: 'capture' | 'correction'` em StartCaptureInput
   - Em startCapture, ANTES de criar inbox:
     - Se mode === 'correction':
       a. Buscar último inbox_item do thread_id:
          - TENTAR primeiro ThreadConversationContextService.buildForThread(threadId)
            (pode precisar ADICIONAR esse método — o existente buildForInbox(inboxItem)
            não atende, pois precisamos do inbox, não temos o item)
          - FALLBACK: inboxRepo.listRecent({ thread_id, limit: 1 }) filtrado
            por thread_id (criar método se não existir)
       b. Se NÃO achar alvo: retornar erro EXPLÍCITO ao user:
          "Corrigir o quê? O thread não tem captura recente."
          (NÃO fallback pra capture — menos surpresa pro user, e fica
          explícito que a correção falhou)
       c. Se achar: chamar this.correctionService.applyCorrection(inboxItem.id, input.text)
          (NÃO criar inbox novo)
     - Se mode === 'capture' (ou sem mode): fluxo atual (cria ou reusa inbox)
   - Adicionar CorrectionService como dependência opcional no construtor
   - Logar stage 'correction_apply' com input={inbox_id, correction_text}, output={applied: bool, correction_id}
   - IMPORTANTE: não confundir com o fluxo de clarificação Telegram
     (tryResolveClarification, que é separado). 'update' = correção de
     inbox item existente; 'clarification' = resposta a uma pergunta
     pendente do extractor.

4. src/services/telegram-inbox.service.ts
   - Trocar a chamada `assistantTurn.startCapture(...)` por `unifiedRouter.handle(capture)`
   - O retorno do router (string) É a resposta pro Telegram. handleIncoming
     DEVE enviar via delivery.sendFollowUp(responseText) — mesmo padrão
     que startCapture usa internamente hoje. Senão a Fase 3 compila mas
     não responde no Telegram.
   - Manter lógica de "nova:" prefix e o tryResolveClarification intactos
     (clarification vem ANTES do router — é uma resposta, não um intent novo)
   - Os stages de parse/thread_resolve/clarification_check adicionados na
     Fase 0 continuam aqui
   - Adicionar stage 'send' no final, com output={message_length, latency_send_ms}

5. src/app.ts
   - Construir RetrievalService, RerankService, RAGPipelineService, IntentClassifierService, CommandHandlerService, UnifiedRouterService
   - Injetar UnifiedRouter (substituindo assistantTurn direto) no TelegramInboxService
   - Passar CorrectionService pra AssistantTurn no construtor

### NÃO MODIFICAR:
- src/config/env.ts e .env.example: as 6 env vars (INTENT_CLASSIFIER_*,
  RAG_*, LOG_DIR) JÁ FORAM ADICIONADAS no commit 172deb2. Não duplicar.

### Testes:

6. tests/unified-router.service.test.ts
   - Mock classifier pra forçar cada intent (save/update/query/command)
   - Verifica que cada intent chama o handler correto
   - Verifica que tudo é logado (mock getCurrentTurn, contar chamadas stage())

7. tests/command-handler.service.test.ts
   - Mock filesystem com logs fake (criar /tmp fake, appendFile mockado)
   - Test /status, /debug, /help, /costs, /log

8. tests/assistant-turn.service.test.ts (atualizar)
   - Test mode='correction' resolve inbox_id correto via ThreadConversationContext
   - Test mode='correction' sem alvo → fallback explícito
   - Test mode='correction' chama CorrectionService.applyCorrection
   - Test mode='capture' (e sem mode) mantém comportamento atual

### Aceite:
- npm test -- unified-router command-handler assistant-turn passa 100%
- Manda "/status" no Telegram e responde com números reais
- Manda "marquei consulta quinta 14h" → intent_classify=save, cria inbox novo
- Manda "na verdade era sexta" (logo após) → intent_classify=update, APLICAR
  correção no inbox anterior do thread (verificar com `select * from
  inbox_items order by created_at desc limit 2` no Supabase)
- Manda "o que eu tenho com Breno?" → intent_classify=query, RAG responde
- O fallback null do getCurrentTurn() (Fase 0) continua funcionando —
  testes que não rodam via ALS não quebram

### Rollback:
- INTENT_CLASSIFIER_ENABLED=false no .env → router pula classificação,
  assume 'save' (comportamento legacy)
- intent 'update' desativado = remover o branch no switch (volta pro
  comportamento de sempre-criar-inbox)
- git revert <commit-fase-3> reverte tudo
```

### Validação:

```bash
npm test -- unified-router command-handler assistant-turn
echo "---"
npm run dev
echo "---"
# manda /status, depois "marquei consulta quinta", depois "na verdade era sexta"
sleep 2
tail -5 /tmp/cerebro-logs/$(date -u +%Y-%m-%d).jsonl | jq -c '{stage, intent: .output.intent, latency_ms}'
echo "--- inbox criado vs corrigido ---"
# no Supabase SQL editor:
# select id, raw_content, created_at from inbox_items order by created_at desc limit 3
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

## Fase 6 — Rollout (conservador)

### Prompt pro Cursor:

```
Tarefa: ligar de verdade, monitorar, ajustar.

IMPORTANTE: INTENT_CLASSIFIER_ENABLED é OPT-OUT (default true se ausente).
Rollout conservador: mesmo com Fases 0-5 estáveis, .env de prod começa
com INTENT_CLASSIFIER_ENABLED=false. Só liga pra true DEPOIS de validar
que legacy ainda funciona como antes.

Sequência de comandos (executar manualmente):

1. Na VM:
   cd /root/segundo-cerebro-tick
   git tag pre-orchestrator
   # Confirma que .env tem INTENT_CLASSIFIER_ENABLED=false (legacy safe)
   grep INTENT_CLASSIFIER_ENABLED .env || echo "INTENT_CLASSIFIER_ENABLED=false" >> .env
   npm run build
   # Restart da API
   pm2 restart cerebro  # ou o comando equivalente

2. Valida legacy: manda 10 mensagens com classifier DESLIGADO,
   confirma que tudo continua funcionando como antes
   (intent_classify stage não aparece no JSONL, comportamento = save sempre)

3. Liga o classifier:
   sed -i 's/INTENT_CLASSIFIER_ENABLED=false/INTENT_CLASSIFIER_ENABLED=true/' .env
   pm2 restart cerebro

4. Manda 10 mensagens variadas no Telegram, depois:
   jq -s 'map(select(.stage=="intent_classify") | .output.intent) | group_by(.) | map({intent: .[0], count: length})' /tmp/cerebro-logs/$(date -u +%Y-%m-%d).jsonl
   # Confere distribuição razoável (não 100% save)

5. Desliga o observer polling:
   pkill -f observer-telegram-bot.ts
   # ou se tiver systemd: systemctl stop observer-bot

6. Monitora por 1 semana:
   - Custo diário: jq -s 'map(.cost_usd // 0) | add' /tmp/cerebro-logs/YYYY-MM-DD.jsonl
   - Erros: jq 'select(.level=="error")' /tmp/cerebro-logs/YYYY-MM-DD.jsonl | head
   - Latência p95: jq -s 'group_by(.stage) | map({stage: .[0].stage, p95: (map(.latency_ms) | sort | .[length * 0.95 | floor])})' /tmp/cerebro-logs/YYYY-MM-DD.jsonl

7. Se tudo OK depois de 7 dias:
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

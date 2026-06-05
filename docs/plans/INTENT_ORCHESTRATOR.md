# Plano: Orquestrador Unificado (Path B) — segundo-cerebro-tick

> **Status:** Draft para revisão. Pronto pra rodar no Cursor.
> **Owner:** Claw (implementação) + Wellerson (decisões + execução)
> **Duração estimada:** 2-3 semanas (6 fases)

---

## TL;DR

Unificar o bot Telegram antigo (que só **extrai** e salva no banco) com o
Observador (que só **lê** via RAG) num **único orquestrador** que decide, por
mensagem, qual caminho seguir. O classificador é um LLM barato (gpt-5-mini,
~50-150 tokens) que classifica a mensagem em `save | update | query | command`
e roteia. Tudo logado estruturadamente pra debug.

Ganho: **uma única interface Telegram, um único token, um único modelo mental**.
Custo adicional: ~$0.0001 por mensagem (o classificador).

---

## Estado atual

```
Telegram → /webhooks/telegram (Fastify)
              │
              ▼
       TelegramInboxService
       ├── checa "nova:" prefix
       ├── tenta resolver clarificação
       └── AssistantTurnService.startCapture
              │
              ├── ExtractionPipelineV14 (LLM extrai)
              ├── persist RPC
              ├── entity upsert
              └── responde (ack ou clarification)

E separado, em outro processo (polling):
       observer-telegram-bot.ts
       ├── hybrid_search
       ├── rerank
       ├── compose
       └── verify
```

**Problema:** dois bots, mesmo token, conflito webhook/polling. Mesmo banco,
mas pipelines não se conversam.

---

## Estado desejado

```
Telegram → /webhooks/telegram (Fastify)
              │
              ▼
       TelegramInboxService
       ├── checa "nova:" prefix
       ├── tenta resolver clarificação
       │
       ▼
   ┌────────────────────────────────────────────┐
   │     UnifiedRouter                           │
   │                                             │
   │  IntentClassifier (LLM gpt-5-mini)         │
   │  → { intent: save|update|query|command,    │
   │       confidence: 0..1,                    │
   │       reasoning: string }                  │
   │                                             │
   │  Route:                                     │
   │   'save'    → AssistantTurn (extrai+salva) │
   │   'update'  → AssistantTurn com ctx update │
   │   'query'   → RAG pipeline (lê+responde)   │
   │   'command' → CommandHandler (/status etc) │
   └────────────────────────────────────────────┘
              │
              ▼
       Telegram sendMessage
              │
              ▼
       Structured logger (JSON-lines)
```

**Tudo num único bot, mesmo token, sem conflito.**

---

## Arquitetura detalhada

### Os 4 intents

| Intent    | Quando                                          | Quem processa             | Latência típica |
| --------- | ----------------------------------------------- | ------------------------- | --------------- |
| `save`    | "marquei consulta com Breno quinta 14h"         | AssistantTurn             | 3-8s            |
| `update`  | "na verdade era sexta, não quinta"              | AssistantTurn + correction| 3-8s            |
| `query`   | "o que eu tenho com Breno essa semana?"         | RAG pipeline              | 1-3s            |
| `command` | "/status", "/debug <id>", "/help"               | CommandHandler            | <100ms          |

### Componentes novos (a criar)

| Arquivo | Responsabilidade | LOC estimado |
| --- | --- | --- |
| `src/services/intent-classifier.service.ts` | LLM classifica intent | ~120 |
| `src/services/retrieval.service.ts` | Wrap hybrid_search (extraído do observer) | ~150 |
| `src/services/rag-pipeline.service.ts` | retrieve→rerank→compose→verify | ~250 |
| `src/services/command-handler.service.ts` | /status, /debug, /help | ~150 |
| `src/services/unified-router.service.ts` | Orquestra classifier + route | ~200 |
| `src/utils/structured-logger.ts` | **(já criado)** JSON-lines, latency, cost | 250 |

### Componentes a modificar

| Arquivo | O que muda |
| --- | --- |
| `src/services/telegram-inbox.service.ts` | Delega ao `UnifiedRouter` em vez de chamar `AssistantTurn` direto |
| `src/services/assistant-turn.service.ts` | Aceita `retrievalContext` opcional e injeta no prompt do extractor (Caminho A) |
| `src/api/telegram-webhook.routes.ts` | Loga webhook_received estruturado, passa turn_id pelo handle |
| `src/app.ts` | Wire do `UnifiedRouter` na DI |
| `src/config/env.ts` | Novas vars: `INTENT_CLASSIFIER_ENABLED`, `INTENT_CLASSIFIER_MODEL`, `RAG_RETRIEVAL_TOP_K`, `LOG_DIR` |
| `.env.example` | Adicionar as mesmas vars |
| `scripts/observer-telegram-bot.ts` | Marcar como DEPRECATED, redirecionar pra `RAGPipelineService` |

---

## As 6 fases

### Fase 0 — Logging estruturado + ALS turn context (4 deliverables)

**O que:** completar a fundação. ALS pra propagar `turn_id` na cadeia async,
testes do logger, shim do logger antigo, e plugar nos 3 pontos Telegram.

**Tarefas no Cursor:**

1. **AsyncLocalStorage** — `src/utils/turn-context.ts`:
   - Wrap com `runWithTurn({...}, fn)` que seta o contexto async
   - `getCurrentTurn()` retorna `null` fora de Telegram (testes, API)
   - Quando null, structured-logger gera turn_id ephemeral automaticamente
   - **Crítico:** `runWithTurn` precisa envelopar a cadeia INTEIRA do webhook
     (incluindo o `.then()`/`.catch()` e o `turn.finish()`)

2. **Testes do structured-logger** — `tests/utils/structured-logger.test.ts`:
   - stage com função async e com objeto estático
   - finish acumula cost_usd
   - erro no stage → re-throw + level=error
   - `estimateCostUsd` por modelo conhecido
   - escrita em LOG_DIR temporário (mock appendFile)

3. **Shim do logger antigo** — `src/utils/logger.ts` (modificar, não deletar):
   - Mantém export `log(level, message, meta)` (não quebra os 9 call sites)
   - Internamente delega ao structured-logger: chama `getCurrentTurn()`;
     se existe, `turn.stage(message, {meta})`; senão, entry avulsa
   - Stdout continua igual, mas arquivo JSONL agora pega TUDO
   - Migração dos 9 call sites pra stages explícitos é trabalho de Fase 6+

4. **Plugar turn_id no pipeline Telegram** — 3 arquivos:
   - `telegram-webhook.routes.ts`: envelopar handleIncoming inteiro em `runWithTurn`,
     incluindo o `.then`/`.catch` e `turn.finish()` no erro
   - `telegram-inbox.service.ts`: `requireCurrentTurn()` no início, stages `parse`,
     `thread_resolve`, `clarification_check`
   - `assistant-turn.service.ts`: `requireCurrentTurn()` no início, stage `extraction`
     envolvendo o v14 pipeline
   - `getCurrentTurn()` retornando null = sem turn_id (testes não quebram)

**Aceite:**
- `npm test -- structured-logger` 100%
- `npm test` geral 100% (nada quebra)
- Manda 1 msg no Telegram, `grep` por `message_id` no JSONL mostra todas as
  entries com o **mesmo** `turn_id`
- ~5 stages por msg: `webhook_received`, `parse`, `thread_resolve`,
  `clarification_check`, `extraction`, `turn_finish`

**Rollback:** `git revert <commit-fase-0>`. O shim do `logger.ts` vira
no-op porque structured-logger também reverte.

---

### Fase 1 — Extrair RAG service do observer bot

**O que:** as funções de RAG tão no `scripts/observer-telegram-bot.ts` como
código procedural. Mover pra services TS de verdade, com tipos, DI, testes.

**Tarefas no Cursor:**

1. Criar `src/services/retrieval.service.ts`:
   - `RetrievalService.retrieve(query, options)` → `HybridRow[]`
   - Internamente: embed() + RPC `hybrid_search` em inbox_items + assertions
   - Input: `{ query: string, topKInbox?: number, topKAssertions?: number, userId?: string }`
   - Output: `{ inbox: RankedRow[], assertions: RankedRow[], latencyMs: number }`

2. Criar `src/services/rag-pipeline.service.ts`:
   - `RAGPipelineService.answer(query, options)` → `string`
   - Pipeline: retrieve → rerank → compose → verify (lógica do observer)
   - `options.openTasks` opcional (lista de tasks abertas pra incluir)
   - Output: resposta final em PT-BR com citação de fontes

3. Criar `src/services/rerank.service.ts`:
   - Extrai a função `rerank()` do observer pra service com DI
   - Input: query, items, keep, model
   - Output: items reordenados + scores

4. Adicionar `tests/rag-pipeline.service.test.ts`:
   - Mock retrieval + LLM
   - Test: "no context" → "Nao encontrei nada"
   - Test: contexto denso → resposta com `[1]` citations
   - Test: verifyCoverage falhando → expande (cobre o caso)

**Aceite:**
```bash
npm test -- rag-pipeline
# 100% dos testes passam
```

**Rollback:** arquivos novos, fácil `git rm` e seguir.

---

### Fase 2 — Intent classifier

**O que:** LLM barato classifica a mensagem num dos 4 intents.

**Tarefas no Cursor:**

1. Criar `src/services/intent-classifier.service.ts`:
   - `IntentClassifierService.classify(text, context)` → `IntentResult`
   - `IntentResult = { intent: 'save' | 'update' | 'query' | 'command', confidence: number, reasoning: string, suggested_command?: string }`
   - System prompt com few-shot examples (uns 5-8 exemplos rotulados)
   - Usa `gpt-5-mini` com `response_format: { type: 'json_object' }` ou schema
   - `max_completion_tokens: 200` (barato)

2. Prompt engineering — exemplos que TEM QUE classificar certo:
   ```
   save:    "marquei consulta com Breno quinta 14h"
   save:    "comprei pão por 8 reais"
   save:    "ideia: fazer um app de pomodoro"
   update:  "na verdade era sexta, não quinta"
   update:  "esquece o Breno, era com João"
   query:   "o que eu tenho com Breno essa semana?"
   query:   "quando foi que eu falei sobre React?"
   query:   "tem alguma task aberta sobre o projeto X?"
   command: "/status"
   command: "/debug abc-123"
   command: "/help"
   ambiguous: "Breno"  → deve ser save (default)
   ```

3. Criar `tests/intent-classifier.service.test.ts`:
   - Mock LLM com respostas fixas
   - Test: cada intent acima é classificado certo
   - Test: ambiguous → 'save' (fallback)
   - Test: confidence < 0.5 → 'save' (fallback seguro)

4. Eval set manual (mínimo 20 mensagens rotuladas):
   - Cria `tests/fixtures/intent-eval.jsonl`
   - 5 save, 3 update, 7 query, 3 command, 2 ambiguous
   - Roda o classificador de verdade e mede hit rate
   - Meta: ≥85% hit rate

5. Adicionar `tests/intent-classifier.eval.test.ts`:
   - Roda o classificador contra o fixture
   - Skip se `OPENAI_API_KEY` não tiver (não bloqueia CI)

**Aceite:**
```bash
npm test -- intent-classifier
# 100% unit tests passam
npm run test:intent:eval   # ≥85% no eval real
```

**Rollback:** service isolado, fácil de remover.

---

### Fase 3 — Command handler + Unified router (com wiring do intent `update`)

**O que:** o router pega o intent e despacha. O intent `update` ganha
wiring real pra `CorrectionService` (que já existe parcialmente).

**Tarefas no Cursor:**

1. **`command-handler.service.ts`** — handle `/status`, `/debug`,
   `/help`, `/costs`, `/log` lendo do JSONL existente. Zero infra extra.

2. **`unified-router.service.ts`** — classifica + despacha:
   - Lê `intent` do classifier (ou assume `save` se `INTENT_CLASSIFIER_ENABLED=false`)
   - `save` → `assistantTurn.startCapture({mode: 'capture'})`
   - `update` → `assistantTurn.startCapture({mode: 'correction'})`
   - `query` → `rag.answer()`
   - `command` → `commands.handle()`

3. **Wiring do intent `update` (não trivial):**
   - Adicionar `mode?: 'capture' | 'correction'` em `StartCaptureInput`
   - Em `AssistantTurn.startCapture`, **antes** de criar inbox:
     - Se `mode === 'correction'`:
       a. Buscar último inbox_item do `thread_id` via `ThreadConversationContextService`
          (já tem `.recentMessages`)
       b. Se **NÃO achar** alvo: fallback explícito ("Corrigir o quê? O thread
          não tem captura recente.")
       c. Se achar: chamar `this.correctionService.applyCorrection(inboxId, text)`
          — **não** criar inbox novo
     - Se `mode === 'capture'` (ou sem mode): fluxo atual
   - Injetar `CorrectionService` no construtor de `AssistantTurn`
   - Stage `correction_apply` com `input={inbox_id}`, `output={applied: bool}`
   - **NÃO confundir** com `tryResolveClarification` (que é resposta a
     pergunta pendente do extractor, fluxo separado que vem ANTES do router)

4. **Modificar `telegram-inbox.service.ts`:**
   - Trocar `assistantTurn.startCapture(...)` por `unifiedRouter.handle(capture)`
   - Manter `nova:` prefix + `tryResolveClarification` intactos

5. **Modificar `src/app.ts`:**
   - Construir `RetrievalService`, `RerankService`, `RAGPipelineService`,
     `IntentClassifierService`, `CommandHandlerService`, `UnifiedRouterService`
   - Passar `CorrectionService` pra `AssistantTurn` no construtor

6. **NÃO modificar** `src/config/env.ts` nem `.env.example` — as 6 vars
   (`INTENT_CLASSIFIER_*`, `RAG_*`, `LOG_DIR`) JÁ FORAM ADICIONADAS no
   commit `172deb2`.

7. **Testes** — atualizar/criar:
   - `tests/unified-router.service.test.ts` — mock classifier, cada intent
   - `tests/command-handler.service.test.ts` — mock filesystem
   - `tests/assistant-turn.service.test.ts` (atualizar) — `mode='correction'`
     com/sem alvo, `mode='capture'` mantém comportamento

**Aceite:**
- `npm test -- unified-router command-handler assistant-turn` 100%
- Manda "marquei consulta quinta 14h" → `intent=save`, cria inbox
- Manda "na verdade era sexta" (logo após) → `intent=update`, **corrige**
  o inbox anterior (verificável com `select * from inbox_items order by
  created_at desc limit 2` no Supabase)
- Manda "/status" → responde com números reais
- Manda "o que eu tenho com Breno?" → `intent=query`, RAG responde

**Rollback:**
- `INTENT_CLASSIFIER_ENABLED=false` → router assume `save` (legacy)
- `git revert <commit-fase-3>` reverte tudo

---

### Fase 4 — Pre-context injection (Caminho A como pré-requisito do B)

**O que:** antes de extrair, o AssistantTurn faz retrieval e injeta
o contexto no prompt do extractor. Isso é o "Caminho A" que melhora
a qualidade da extração.

**Tarefas no Cursor:**

1. Modificar `src/services/assistant-turn.service.ts`:
   - Em `startCapture`, ANTES de chamar o v14 pipeline:
     - `turn.stage('retrieval_for_extraction', ...)` → chama `RetrievalService`
     - Formata resultado como contexto legível pro LLM
   - Modificar o `extractor-v1.4.prompt.ts` pra aceitar `contextBlock`
   - Testa com `tests/assistant-turn.service.test.ts`

2. Adicionar `tests/pre-context.test.ts`:
   - Mock retrieval com 3 items conhecidos
   - Verifica que o prompt do extractor inclui esses items
   - Verifica que entity resolution melhora (mock extractor retorna entity_id)

3. Rodar o `observer-eval.ts` antes e depois:
   - Baseline: sem pre-context (comita baseline.json)
   - Depois: com pre-context
   - Compara recall@k, MRR

**Aceite:**
```bash
npm test -- pre-context
# unit tests passam
npm run observer-eval -- --compare baseline.json current.json
# recall@k melhorou ≥5pp OU mantive
```

**Rollback:** tirar a chamada de retrieval no `startCapture`, reverter
o prompt. Comportamento volta ao baseline.

---

### Fase 5 — Bot commands para debug (já na Fase 3, mas polir UX)

**O que:** melhorar a experiência dos comandos no Telegram.

**Tarefas no Cursor:**

1. Adicionar `inline_keyboard` no `/status`:
   - "Ver custos" / "Ver últimos 5 turnos" / "Ver erros"
2. `/debug` aceita turn_id **OU** último turno (se omitido)
3. `/costs` retorna breakdown por stage
4. `/log` retorna últimos 20 entries de log (sanitizado)

**Aceite:** interativo, claro, latência <200ms.

**Rollback:** commands não fazem parte do path crítico, fácil de remover.

---

### Fase 6 — Rollout

**O que:** ligar de verdade, monitorar, ajustar.

**IMPORTANTE — rollout conservador:** mesmo depois de Fase 3-5 prontas,
o `.env` de prod deve começar com `INTENT_CLASSIFIER_ENABLED=false` (legacy
behavior). Só liga pra `true` depois que as Fases 0-5 estiverem estáveis
em prod, porque `INTENT_CLASSIFIER_ENABLED` é **opt-out** (default `true`
se ausente). Default seguro em prod: `INTENT_CLASSIFIER_ENABLED=false` até
essa fase.

**Sequência:**

1. `git tag pre-orchestrator` antes de ativar
2. Confirma `.env` de prod tem `INTENT_CLASSIFIER_ENABLED=false` (legacy safe)
3. Manda 10 mensagens com o classificador DESLIGADO, valida que tudo
   continua funcionando como antes
4. Liga `INTENT_CLASSIFIER_ENABLED=true` no .env
5. Manda 10 mensagens variadas, monitora logs:
   - `cat /tmp/cerebro-logs/$(date -u +%Y-%m-%d).jsonl | jq 'select(.stage=="intent_classify")'`
   - Confere que intents tão batendo (distribuição razoável, não 100% save)
6. Se hit rate ≥85%, segue. Se não, volta pra Fase 2 e ajusta prompt.
7. Desliga o observer polling bot:
   ```bash
   ssh vm "pkill -f observer-telegram-bot.ts"
   # ou se tiver systemd, systemctl stop observer-bot
   ```
8. `git tag post-orchestrator` depois de 1 semana estável
9. **Deletar** o `scripts/observer-telegram-bot.ts` (ou marcar DEPRECATED com redirect)

**Rollback total:** `INTENT_CLASSIFIER_ENABLED=false` + `git revert` no commit
da Fase 3. Volta a comportar como antes (sempre `save`).

---

## Logging (referência rápida)

Já implementado em `src/utils/structured-logger.ts`. Schema de cada entry:

```json
{
  "ts": "ISO-8601",
  "level": "info|warn|error|debug",
  "stage": "webhook_received|intent_classify|retrieval|...",
  "turn_id": "uuid",
  "user_id": 12345,
  "chat_id": 67890,
  "message_id": 999,
  "latency_ms": 234,
  "input": "user message",
  "output": {...},
  "model": "gpt-5-mini",
  "input_tokens": 120,
  "output_tokens": 8,
  "cost_usd": 0.000046,
  "error": null
}
```

**Comandos úteis:**

```bash
# última interação completa
tail -1 /tmp/cerebro-logs/$(date -u +%Y-%m-%d).jsonl | jq

# todos os intents de hoje
jq 'select(.stage=="intent_classify")' /tmp/cerebro-logs/$(date -u +%Y-%m-%d).jsonl

# latência p95 por estágio
jq -s 'group_by(.stage) | map({stage: .[0].stage, p95_ms: (map(.latency_ms) | sort | .[length * 0.95 | floor])})' /tmp/cerebro-logs/$(date -u +%Y-%m-%d).jsonl

# custo total do dia
jq -s 'map(.cost_usd // 0) | add' /tmp/cerebro-logs/$(date -u +%Y-%m-%d).jsonl

# erros de hoje
jq 'select(.level=="error")' /tmp/cerebro-logs/$(date -u +%Y-%m-%d).jsonl

# tudo de um turn específico
jq 'select(.turn_id=="abc-123")' /tmp/cerebro-logs/$(date -u +%Y-%m-%d).jsonl
```

**Custo por stage (atual):**
- `intent_classify`: ~$0.0001 (gpt-5-mini, ~200 tokens)
- `extraction`: ~$0.005-0.01 (gpt-5-mini, schema complexo)
- `rerank`: ~$0.001 (gpt-5-mini, ~500 tokens)
- `compose`: ~$0.003-0.008 (gpt-5-mini, contexto grande)
- `embed`: ~$0.000002 (text-embedding-3-small)
- `hybrid_search`: grátis (Supabase RPC)

Por mensagem típica: **~$0.01-0.02 total**. Adicionando o classificador:
+10% (~$0.0011).

---

## Tests — checklist por fase

| Fase | Test command | Critério |
| --- | --- | --- |
| 0 | `npm test` | passa, mais 1 entry de log por turno no arquivo |
| 1 | `npm test -- rag-pipeline retrieval` | 100% passa |
| 2 | `npm test -- intent-classifier` + `npm run test:intent:eval` | unit 100% + eval ≥85% |
| 3 | `npm test -- unified-router command-handler` | 100% passa |
| 4 | `npm test -- pre-context` + `observer-eval --compare` | unit 100% + recall ≥baseline |
| 5 | (manual) | comandos respondem em <200ms |
| 6 | (manual) | 7 dias estável, custo dentro do esperado |

---

## Rollback — comandos exatos

```bash
# rollback de cada fase (em ordem inversa)
git revert <commit-fase-6>
git revert <commit-fase-5>
git revert <commit-fase-4>
git revert <commit-fase-3>
git revert <commit-fase-2>
git revert <commit-fase-1>
git revert <commit-fase-0>   # ou reverter tudo de uma vez

# fallback de runtime (sem mexer em código):
INTENT_CLASSIFIER_ENABLED=false   # .env, força save sempre
LOG_DIR=/dev/null                  # silencia log file
```

---

## Open questions (decidir antes de começar)

1. **Set de intents**: 4 (save/update/query/command) é suficiente ou quer
   granularidade maior? Ex: `confirm`, `delete`, `list_tasks` separados?
2. **Destino do observer bot**: deletar, manter como fallback, ou só marcar
   DEPRECATED?
3. **Custo aceitável/dia**: quanto tu topa gastar com o classificador?
   (~$0.001/msg × 50 msgs/dia = $0.05/dia, baratíssimo)
4. **Eval dataset**: tens 20-30 mensagens rotuladas pra medir o classificador?
   Se não, a gente cria junto na Fase 2.
5. **Logging persistente**: logs em `/tmp` somem no reboot da VM. Quer
   mover pra `/var/log/cerebro/` com logrotate, ou seguir em `/tmp`?
6. **Comandos no Telegram**: `/status`, `/debug`, `/help`, `/costs`, `/log` —
   confirmar lista ou sugerir mais (ex: `/undo`, `/recap`)?

---

## Referências no código (pra navegar)

- `src/app.ts` — DI/wiring (aqui a gente pluga o UnifiedRouter)
- `src/api/telegram-webhook.routes.ts` — entrada do webhook
- `src/services/telegram-inbox.service.ts` — orquestração atual (aqui troca)
- `src/services/assistant-turn.service.ts` — pipeline de extração (Fase 4)
- `src/openai/extractor-v1.4.prompt.ts` — prompt do extractor (Fase 4 injeta ctx)
- `scripts/observer-telegram-bot.ts` — fonte do RAG (Fase 1 extrai)
- `src/utils/logger.ts` — logger atual (Fase 0 evolui pra structured)
- `src/utils/structured-logger.ts` — **já criado**
- `tests/` — vitest suite (cobre 200+ testes)

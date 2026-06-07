# Fase 5 — Contextual Reasoner

> **Status:** Implementação inicial (Fase 5.1 — scaffold + integração). Próximas: 5.2 (eval suite expandida), 5.3 (rollout gradual).
> **Owner:** Claw (implementação) + Wellerson (decisões + execução)
> **Data:** 2026-06-07
> **Problema que resolve:** J1 (prazo repetido em sub-task) + J3 (clarif pile-up) + qualquer padrão futuro de "reply vs new capture" / "thread continuation" / "update to existing task".

---

## TL;DR

Adicionar um **LLM Reasoner consciente do contexto** entre a criação do inbox e a extração v14. O Reasoner recebe a mensagem atual + clarifs pendentes + thread context + tasks ativas relevantes, e devolve um único JSON com:

1. **Inferência de intent contextual** (não apenas "save" — pode ser `reply_to_pending`, `new_capture`, `mixed`, `cancel_pending`, `update_existing`)
2. **Resolução de clarifs pendentes** (quais perguntas a nova msg já responde, com a resposta extraída)
3. **Extração refinada** (passada pra v14 com contexto adicional se for `mixed` / `update_existing`)
4. **Novas clarifs** (SÓ pra gaps genuinamente desconhecidos que o contexto não cobre)

O Reasoner **NÃO substitui** o extractor v14. Ele só decide **o que** extrair e **em que contexto**, alimentando o v14 com input mais rico quando necessário.

---

## Por que isso resolve J1, J3 e futuros

### J1 (prazo repetido em sub-task)

**Hoje:** uncertainty-aggregator vê `task_signals[0].due_at = null` na msg 231 (porque o LLM extraiu "Eu mesmo vou corrigir" sem prazo) e dispara "qual o prazo?".

**Com Reasoner:** ele vê:
- Msg 231 atual = "Eu mesmo vou corrigir, são melhorias no âmbito de produto. Que terei que codar."
- Thread context = msg 228 já tem task pai "Corrigir os pontos do projeto Miranda" com `due_at = "hoje mesmo"`
- Clarif pendente = "Quem será o responsável?"

Decisão do Reasoner: `mixed` — responde clarif "Quem" com "Eu mesmo" (resolução), E a nova task "Corrigir melhorias no âmbito de produto" é uma SUB-TAREFA da pai, então **herda `due_at = "hoje"`**. Nenhuma clarif nova.

### J3 (clarif pile-up)

**Hoje:** msg 228 respondeu as 2 clarifs da msg 225 (datas Websummit + prazo Miranda), mas o inbox service criou uma 3ª clarif "Quem será o responsável?" sem checar pendentes.

**Com Reasoner:** ele vê:
- Msg 228 atual = "Websummit começa amanhã, dia 08... pretendo acabar hoje mesmo."
- 2 clarifs pendentes:
  - "Qual a data de 'Estar no Rio pela Websummit'?" → resposta: 08-11 jun
  - "Para 'Corrigir...': qual o prazo?" → resposta: hoje mesmo

Decisão: `reply_to_pending` — resolve as 2 clarifs com as respostas extraídas. Zero clarifs novas.

### Edge cases futuros (sem código novo)

| Padrão | Decisão do Reasoner |
|---|---|
| "Na verdade o prazo é amanhã" (sobrescrevendo "hoje") | `update_existing` + atualiza `due_at` na task pai |
| "Esquece, desisto dessa task" | `cancel_pending` + marca task como `superseded` |
| Msg ambígua entre thread A e B | `mixed` ou `update_existing` baseado em qual task pai o Reasoner identifica |
| "Confirma também: +1 pessoa nova" | `mixed` — resolve clarif atual + captura novo entity |

---

## Arquitetura

### Fluxo atual

```
Telegram → inbox.create() → extraction.v14() → uncertainty.aggregate() → followup
```

### Fluxo novo (REASONER_ENABLED=true)

```
Telegram → inbox.create() → reasoner.reason() → dispatch:
                                              ├── pure_reply → clarificationService.resolve() (sem extração)
                                              ├── new_capture → extraction.v14()
                                              ├── mixed → clarificationService.resolve() + extraction.v14() (com context)
                                              └── update_existing → correctionService.apply()
```

### Componentes novos

| Arquivo | Responsabilidade |
|---|---|
| `src/services/contextual-reasoner.prompt.ts` | System prompt + few-shots + JSON schema (Zod) |
| `src/services/contextual-reasoner.service.ts` | Chamada LLM + retry + parse + validação |
| `src/services/contextual-reasoner.types.ts` | `ReasonInput` / `ReasonOutput` / `ReasonDecision` |
| `tests/contextual-reasoner.eval.ts` | 15+ cenários reais (com asserções de decisão) |
| `tests/contextual-reasoner.service.test.ts` | Unit tests: parse, fallback, error handling, sanity-checks |

### Integração mínima

- Novo stage ALS: `reason` (entre `route_dispatch` e `extraction`)
- Novo flag env: `REASONER_ENABLED` (default: **false** até 5.3)
- DI bottom-up em `app.ts`: `ContextualReasonerService` construído se `REASONER_ENABLED && OPENAI_API_KEY`
- Wire no `AssistantTurnService.runCapturePipeline` — antes do `v14Process.processById`

### O que NÃO muda

- DB writes (continuam rule-based, transacionais)
- Materiality calc (lógica de negócio, não toca)
- Top-level intent classifier (save/query/command) — continua separado, é mais rápido
- Extractor v14 (continua sendo o especialista em extração estrutural)
- Sanitizer (vira **safety net pós-LLM** + pós-Reasoner)
- ClarificationService (continua gerenciando lifecycle de clarifs)

---

## ReasonInput — o que o LLM recebe

```typescript
interface ReasonInput {
  currentMessage: string;
  channel: 'telegram' | 'api';
  receivedAt: string;          // ISO timestamp
  timezone: string;           // 'America/Sao_Paulo'

  pendingClarifications: Array<{
    id: string;
    question: string;
    issue_type: string;
    target_reference: string;
    suggested_answers: string[];
    source_excerpt: string;
    inbox_item_id: string;
  }>;

  threadContext: {
    thread_id: string;
    recentMessages: Array<{
      inbox_item_id: string;
      raw_content: string;
      created_at: string;
    }>;                          // últimas 3-5 msgs
    salientEntities: Array<{     // pessoas/projetos ativos
      reference: string;
      canonicalName: string | null;
      entityType: string | null;
    }>;
  };

  activeTasks: Array<{          // tasks recentes do mesmo thread
    id: string;
    title: string;
    status: string;
    due_at: string | null;
    assignee_reference: string | null;
    project_reference: string | null;
    inbox_item_id: string;
    created_at: string;
  }>;
}
```

**Tamanho típico do prompt:** ~2-3k tokens (current message ~500 + clarifs pendentes ~300 + thread context ~1500 + tasks ativas ~500). Cabe em gpt-4o-mini com folga.

---

## ReasonOutput — o que o LLM devolve

```typescript
interface ReasonOutput {
  decision: {
    kind: 'pure_reply' | 'new_capture' | 'mixed' | 'update_existing' | 'cancel_pending' | 'unrelated';
    confidence: number;             // 0-1
    reasoning: string;              // 1-2 frases explicando a decisão
  };

  // 1. Resoluções de clarifs pendentes (vazio se kind=new_capture puro)
  clarif_resolutions: Array<{
    clarification_id: string;
    answered: boolean;              // false se a msg NÃO responde essa clarif
    answer: string | null;          // string normalizada do que o user disse
    confidence: number;             // 0-1
  }>;

  // 2. Updates em tasks existentes (vazio se kind=new_capture puro)
  task_updates: Array<{
    task_id: string;                // ID da task que está sendo atualizada
    operation: 'update_due_date' | 'update_assignee' | 'update_status' | 'complete' | 'cancel';
    new_value: string | null;       // 'hoje mesmo', 'Eu mesmo', etc
    inherit_from_parent: boolean;   // true se due_at veio do parent task
    parent_task_id: string | null;  // se for sub-task, ID da pai
    reasoning: string;              // 1 frase explicando
  }>;

  // 3. Conteúdo novo sendo capturado (vazio se pure_reply)
  new_capture: {
    effective_input: string;        // texto a ser passado pro v14 (pode ser diferente do currentMessage se mesclou contexto)
    summary: string;                // 1 frase pro log
  } | null;

  // 4. Clarifs genuinamente novas (SÓ pra gaps que o contexto NÃO cobre)
  new_clarifications: Array<{
    question: string;
    target_reference: string;
    issue_type: string;             // canônico v14 enum
    suggested_answers: string[];
    priority: number;               // 0-100
    reasoning: string;              // 1 frase explicando POR QUÊ precisa perguntar
  }>;
}
```

**Regras duras no prompt:**
- Se a msg atual responde QUALQUER parte de uma clarif pendente, a decisão é NO MÍNIMO `mixed` (não `new_capture` puro)
- `new_clarifications` SÓ pode ter itens que **NÃO** foram respondidos no contexto (incluindo thread + tasks ativas)
- `task_updates` com `inherit_from_parent=true` é a saída canônica pra J1 (sub-task herda prazo)
- Se a msg é totalmente não relacionada a qualquer contexto, decisão é `unrelated` e o pipeline segue como new_capture

---

## Few-shots (essenciais pra acertar)

### Few-shot 1: J1 (sub-task herda prazo)

**Input:**
- currentMessage: "Eu mesmo vou corrigir, são melhorias no âmbito de produto. Que terei que codar."
- pendingClarifications: [{ question: "Quem será o responsável por corrigir os pontos do projeto Miranda?", target_reference: "responsável", suggested_answers: ["Eu (você)", "Cátia", "Outra pessoa"] }]
- threadContext.recentMessages: [..., { raw_content: "Websummit começa amanhã, dia 08 de junho e termina dia 11... Sobre corrigir os pontos do projeto Miranda, pretendo acabar hoje mesmo." }]
- activeTasks: [{ id: "task_abc", title: "Corrigir os pontos do projeto Miranda", status: "open", due_at: "2026-06-07" }]

**Output esperado:**
```json
{
  "decision": { "kind": "mixed", "confidence": 0.95, "reasoning": "Responde clarif 'Quem' + cria sub-task que herda prazo do pai." },
  "clarif_resolutions": [{ "clarification_id": "...", "answered": true, "answer": "Eu mesmo", "confidence": 0.97 }],
  "task_updates": [{
    "task_id": "task_abc",
    "operation": "update_assignee",
    "new_value": "Wellerson",
    "inherit_from_parent": false,
    "parent_task_id": null,
    "reasoning": "User disse 'Eu mesmo vou corrigir'."
  }],
  "new_capture": {
    "effective_input": "Eu mesmo vou corrigir os pontos do projeto Miranda. As correções são melhorias no âmbito de produto que terei que codar.",
    "summary": "Sub-task 'Corrigir melhorias no âmbito de produto' (filha de 'Corrigir os pontos do projeto Miranda')."
  },
  "new_clarifications": []
}
```

### Few-shot 2: J3 (resolve 2 clarifs de uma vez)

**Input:**
- currentMessage: "Websummit começa amanhã, dia 08 de junho e termina dia 11. Inclusive enviarei muitas coisas relacionadas ao websummit para que você registre. Mas só voltarei do Rio dia 14. A lari chega no rio dia 12 e estaremos juntos até dia 14 quando voltaremos a BH. Sobre corrigir os pontos do projeto Miranda, pretendo acabar hoje mesmo."
- pendingClarifications: [
    { question: "Qual a data de 'Estar no Rio pela Websummit'?", target_reference: "Estar no Rio pela Websummit" },
    { question: "Para 'Corrigir os pontos do projeto Miranda': qual o prazo?", target_reference: "Corrigir os pontos do projeto Miranda" }
  ]
- threadContext.recentMessages: [...]
- activeTasks: [...]

**Output esperado:**
```json
{
  "decision": { "kind": "reply_to_pending", "confidence": 0.92, "reasoning": "Responde as 2 clarifs pendentes: datas Websummit (08-11 jun) + prazo Miranda (hoje)." },
  "clarif_resolutions": [
    { "clarification_id": "...", "answered": true, "answer": "08-06 a 11-06", "confidence": 0.95 },
    { "clarification_id": "...", "answered": true, "answer": "hoje mesmo (2026-06-07)", "confidence": 0.95 }
  ],
  "task_updates": [],
  "new_capture": {
    "effective_input": "Websummit: começa amanhã (08-06) e termina 11-06. Voltarei do Rio dia 14. A Lari chega no Rio dia 12 e voltaremos juntos a BH dia 14. Sobre corrigir os pontos do projeto Miranda, pretendo acabar hoje mesmo.",
    "summary": "Resolve pendentes + adiciona contexto Websummit (datas, viagem, Lari)."
  },
  "new_clarifications": []
}
```

### Few-shot 3: pure new capture (não toca em clarifs)

**Input:**
- currentMessage: "ideia: app de pomodoro com integração ao notion"
- pendingClarifications: []
- threadContext.recentMessages: [...]
- activeTasks: [...]

**Output esperado:**
```json
{
  "decision": { "kind": "new_capture", "confidence": 0.99, "reasoning": "Sem clarifs pendentes; conteúdo novo e não relacionado a tasks ativas." },
  "clarif_resolutions": [],
  "task_updates": [],
  "new_capture": {
    "effective_input": "ideia: app de pomodoro com integração ao notion",
    "summary": "Ideia nova: app pomodoro + Notion."
  },
  "new_clarifications": []
}
```

### Few-shot 4: cancel

**Input:**
- currentMessage: "esquece, desisti do app de pomodoro"
- pendingClarifications: []
- activeTasks: [{ id: "task_xyz", title: "App de pomodoro com Notion", status: "open" }]

**Output esperado:**
```json
{
  "decision": { "kind": "cancel_pending", "confidence": 0.9, "reasoning": "User cancelou task ativa 'App de pomodoro'." },
  "clarif_resolutions": [],
  "task_updates": [{ "task_id": "task_xyz", "operation": "cancel", "new_value": null, "inherit_from_parent": false, "parent_task_id": null, "reasoning": "User disse 'desisti'." }],
  "new_capture": null,
  "new_clarifications": []
}
```

---

## Decisão de modelo

**gpt-4o-mini** é suficiente pro Reasoner:
- Reasoning mais simples que o extractor v14
- Latência menor (1-3s vs 30-60s do gpt-5-mini)
- Custo menor (~$0.0001/msg)
- Temperature: 0 (decisão determinística)
- max_tokens: 1500 (output é estruturado e curto)

Manter gpt-5-mini no extractor v14 (precisa de raciocínio profundo pra extração estrutural).

---

## Avaliação

### 5.1 — Implementação inicial (este commit)

- Service skeleton + prompt + 4 few-shots canônicos
- Wire com flag `REASONER_ENABLED=false` (não ativa em produção por default)
- 15+ cenários no eval suite (alguns com asserções, alguns como smoke)
- Testes unit: parse, fallback, validation
- Documentação: este doc + MEMORY.md + .env.example + README

### 5.2 — Validação (próximo passo)

- Rodar eval suite com REASONER_ENABLED=true localmente
- Comparar decisões do Reasoner vs pipeline atual
- Ajustar prompt + few-shots baseado em falhas
- Medir latência: Reasoner deve adicionar <3s ao pipeline

### 5.3 — Rollout gradual

- 5.3.1: `REASONER_ENABLED=true` em ambiente de homolog (local Wellerson)
- 5.3.2: Shadow mode (Reasoner roda mas decisão NÃO é usada; só loga)
- 5.3.3: Canary 10% das mensagens (sample por source_reference)
- 5.3.4: Default ON em produção após 1 semana de shadow estável

---

## Métricas de sucesso

- **Precisão do Reasoner**: >=90% das decisões batem com o que Wellerson faria manualmente (eval suite)
- **Latência**: +<3s por save (Reasoner adiciona um LLM call)
- **Redução de clarifs**: -50% de clarifs repetidas (medir pre/post Reasoner)
- **Zero regressão**: pipeline atual continua funcionando 100% quando REASONER_ENABLED=false

---

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| LLM alucina `task_id` que não existe | Sanity check pós-parse: `task_id` DEVE estar em `activeTasks`. Se não, drop + log + fallback pra `new_capture` |
| LLM erra `decision.kind` (ex: diz `new_capture` mas responde clarif) | Regra dura no prompt + sanity check: se `clarif_resolutions` tem `answered=true`, `kind` DEVE ser `mixed` ou `reply_to_pending` |
| Latência adicional impacta UX | Reasoner usa gpt-4o-mini (rápido). Flag `REASONER_ENABLED=false` por default em produção |
| Contexto vaza dados privados entre threads | Reasoner SÓ recebe threadContext do thread atual. `activeTasks` filtrado por thread_id |
| Eval suite não cobre edge cases reais | Adicionar cenários baseado em runs reais do Wellerson (não sintéticos) |
| LLM não tem capacidade de raciocínio contextual | gpt-4o-mini + few-shots explícitos é suficiente. Se falhar, upgrade pra gpt-5-mini no Reasoner |

---

## Rollback

- `REASONER_ENABLED=false` no env → pipeline volta ao comportamento atual
- Service deletável sem quebrar nada (não é dependência hard)
- Se Reasoner causar regressão, basta flipar flag e investigar via logs ALS

---

## Próximas fases (depois de 5.3)

- **5.4**: Reasoner aprende few-shots de runs reais (curated set baseado em decisões que Wellerson confirmou)
- **5.5**: Reasoner multi-thread (resolve clarifs de qualquer thread do user, não só atual)
- **5.6**: Reasoner proativo (sugere follow-ups baseado em tasks próximas do vencimento)

Não fazer nenhuma dessas até 5.3 validar que o básico funciona.

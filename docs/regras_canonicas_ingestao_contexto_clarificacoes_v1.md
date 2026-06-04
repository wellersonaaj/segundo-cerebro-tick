# Regras canônicas — ingestão, contexto e clarificações v1

**Status:** ativo para calibração extractor-v1.4 / Memory Compiler v2 / Clarification Manager v2.  
**Não aplicado** ao runtime produtivo v1.3.

---

## 1. Taxonomia canônica de `issue_type`

O extrator v1.4 emite `clarification_candidates[].issue_type` **somente** com valores do enum:

```ts
type ClarificationIssueType =
  | 'ambiguous_identity'
  | 'ambiguous_entity_type'
  | 'ambiguous_task_reference'
  | 'missing_task_reference'
  | 'missing_due_date'
  | 'missing_assignee'
  | 'missing_assignee_or_due_date'
  | 'ambiguous_date'
  | 'unclear_scope'
  | 'missing_external_action_target'
  | 'possible_contradiction'
  | 'other';
```

Implementação: `CLARIFICATION_ISSUE_TYPES` em `src/openai/extractor-v1.4.types.ts` + enum equivalente no JSON Schema OpenAI strict.

### Proibições

- Não criar sinônimos ou novos nomes (ex.: `missing_assignment_and_deadline` → inválido).
- Não usar substring ou mapeamento ad hoc no Clarification Manager para “adivinhar” equivalências.

### Fallback `other`

Quando nenhuma categoria representar adequadamente a dúvida:

```text
issue_type = other
reason     = explicação livre com a nuance
```

### Equivalências semânticas explícitas (prompt)

| Situação | `issue_type` canônico |
|----------|----------------------|
| Ausência simultânea de responsável e prazo em tarefa | `missing_assignee_or_due_date` |
| Identidade de entidade ambígua | `ambiguous_identity` |
| Tarefa existente não identificável | `missing_task_reference` ou `ambiguous_task_reference` |

---

## 2. Materialidade (Clarification Manager v2)

### Non-blocking (enrichment em `create` registrável)

Somente estes tipos, com título não vazio e sem blockers materiais:

- `missing_due_date`
- `missing_assignee`
- `missing_assignee_or_due_date`
- `unclear_scope` (guardas: sem ação externa imediata, sem conflito de identidade/alias/contradição, sem ambiguidade de task reference)

### Blocking por padrão

- `issue_type = other` → **blocking** até regra explícita.
- Ambiguidades reais (`ambiguous_task_reference`, `ambiguous_identity`, etc.).
- Updates sem target resolvido.

### Discarded

Regras existentes de descarte (correção resolvida, ruído de calibração, etc.) permanecem inalteradas.

---

## 2.1 `blocking_scope` e promoção (`promote_extraction_run`)

| `blocking_scope` | Bloqueia promote? | Efeito operacional |
|------------------|-------------------|--------------------|
| `task_execution` | **Não** | Memória compila e promove; clarification permanece `pending` e impede **execução** da tarefa até resposta |
| `knowledge_confirmation` | **Sim** | Promote falha com `BLOCKING_CLARIFICATIONS` |
| `external_action` | **Sim** | Promote falha com `BLOCKING_CLARIFICATIONS` |

Implementação: filtro em `promote_extraction_run` (`20260602100001_greenfield_rpcs.sql`).

---

## 2.2 `missing_task_target` determinístico (Memory Compiler v2)

Quando uma tarefa `create` menciona fornecedor genérico **sem alvo identificável**, o compiler emite **sem depender da LLM**:

```text
issue_type      = missing_task_target
blocking_scope  = task_execution
question        = "Qual fornecedor deve ser cobrado?"
source          = compiler
```

**Dispara quando** `target_reference` está ausente ou é apenas genérico (`fornecedor`, `o fornecedor`, `fornecedores`).

**Não dispara quando** `target_reference` traz identificador específico (ex.: `Genius Hotels`, `fornecedor ACME`).

Motivação: v1.4 tende a emitir `missing_assignee`, descartado pelo CM v2 em `create` registrável; o cenário Genius/fornecedor exige clarification mínima sobre **qual** fornecedor cobrar.

---

## 3. Contexto de ingestão (regimes)

Regimes de calibração: `first_contact`, `incremental_single`, `incremental_ambiguous`.

Resolução de `task_reference` via `TaskContextResolverService` + `IngestionContextSelectorService` — ver Bloco 4D.

---

## 4. Quality gate semântico (Bloco 4F) — **approved**

- Runner: `ALLOW_EXTRACTOR_V14_LIVE_CALIBRATION=true npm run test:extractor:v1.4:live`
- Relatórios: `artifacts/calibration/extractor-v1.4-semantic-gate-report.json`, `extractor-v1.4-semantic-gate-summary.md`
- Capturas isoladas por `run_id` em `artifacts/calibration/extractor-v1.4-live-runs/<run_id>/`
- Métricas não aplicáveis à seleção de categorias não reprovam o gate (`not_applicable`, `value: null`, `applicable_runs: 0`)

### Gate amplo final (2026-06-03)

| Campo | Valor |
|-------|--------|
| Veredito | **semantic gate extractor-v1.4 = approved** |
| `run_id` | `v14-live-2026-06-03T00-20-08-750Z-88484fa2` |
| Runs | 13 categorias × 5 = 65 |
| Case pass | 64/65 (98,5%) |
| `pass` / exit | `true` / 0 |

Thresholds finais atendidos no agregado: `structured_output_validity`, `alias_target_recall`, `entity_precision`, `event_kind_match`, `negation_error_rate`, `alias_as_entity_rate`, `preference_to_event_rate`, `description_corruption_rate`, `task_signal_emission_recall`, `context_resolution_success_rate`, `task_recall`, `project_status_update_recall`, `source_block_reference_validity`, `true_ambiguity_clarification_recall`, `false_blocking_clarification_rate` — ver tabela completa em `docs/extractor-v1.4-spec.md` §12.1.

### Limitação conhecida (registrar, não corrigir agora)

- **`static_preferences`:** 1/5 run (`live-v14-static_preferences-r3-0f80170c`) emitiu `assertion_kind: fact` em vez de `opinion`; não bloqueou `finalDecision`. Classificação: variabilidade LLM em taxonomia de assertion — auditoria offline opcional; fora do escopo do gate.

### Próximo bloco

**Bloco 5 — normalização determinística de datas relativas** — ver `docs/bloco-5-normalizacao-datas-relativas-plano.md`. Sem alteração de runtime semântico (extractor, compiler, CM) até implementação explícita do Bloco 5.

---

## 5. Referências

- Contrato completo: [`docs/extractor-v1.4-spec.md`](extractor-v1.4-spec.md)
- Plano Bloco 5 (datas): [`docs/bloco-5-normalizacao-datas-relativas-plano.md`](bloco-5-normalizacao-datas-relativas-plano.md)
- Changelog: [`docs/changelog-arquitetural.md`](changelog-arquitetural.md)
- Backlog v1.2: [`docs/backlog_segundo_cerebro_pessoal_v1.2.md`](backlog_segundo_cerebro_pessoal_v1.2.md)

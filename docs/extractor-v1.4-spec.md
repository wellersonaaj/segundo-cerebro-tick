# Extractor v1.4 — especificação canônica (greenfield)

**Status:** calibração extractor-v1.4 **aprovada** (semantic gate amplo); **não promovido** ao runtime produtivo (pipeline permanece v1.3).  
**Gerado em:** 2026-06-02 · **Gate aprovado em:** 2026-06-03  
**Auditoria:** `artifacts/calibration/compiler-v1-live-audit-detail.json` (80 capturas live v1.3)  
**Rascunho automático:** `artifacts/calibration/extractor-v1.4-spec.generated.md` (não substitui este documento)

## 1. Princípio

Produto sem dados reais em produção. Homologação descartável.

- **extractor-v1.4** = primeiro contrato canônico do Structured Output.
- **extractor-v1.3** preservado apenas como baseline histórica (fixtures, artifacts, comparação).
- Sem adapter v1.3, sem campos redundantes, sem `entity_id` na LLM.
- Identidade canônica: **Memory Resolver + Entity Registry** (não a LLM).

---

## 2. Auditoria live (80 capturas)

Fonte: `artifacts/calibration/live-captures/` (8 categorias × 10 repetições).  
Compiler v1 usado **somente** para retrospectiva (`compiled_v1_retrospective`).

### 2.1 Contagem A–F revisada

| Classificação | Qtd | % |
|---------------|-----|---|
| A_compiler_deterministic | 11 | 13.8% |
| B_fixture_incomplete | 11 | 13.8% |
| C_schema_signal_gap | 38 | 47.5% |
| D_extractor_prompt | 0 | 0% |
| E_legitimate_ambiguity | 0 | 0% |
| F_metric_or_label_error | 20 | 25.0% |
| **Total** | **80** | |

Comparado ao relatório antigo (`classifyLiveDivergence` com 57× `D: ok`): a classificação revisada separa **gap de schema (C)** de **métrica/rotulador (F)**.

### 2.2 Por categoria

| Categoria | n | Dominante | Nota |
|-----------|---|-----------|------|
| bootstrap_panorama | 10 | A (10) | Gate v1 absorve panorama |
| static_preferences | 10 | B (10) | Expected `allowed` vs nomes curtos |
| episodic_meeting | 10 | C (9), B (1) | `event_kind` / related_entities ausentes em v1.3 |
| episodic_confirmation | 10 | F (10) | Métrica entity sem contrato entity |
| alias_negation | 10 | F (10) | Métrica ignora `alias_targets` |
| alias_reassignment | 10 | C (9), A (1) | Codinome como entidade |
| correction_participant | 10 | C (10) | Falta `correction_signals` estruturado |
| correction_document_sender | 10 | C (10) | Idem |

### 2.3 Exemplos representativos

| scenario_id | Classe | Causa |
|-------------|--------|-------|
| live-alias_reassignment-r1-8875dd00 | C | `Codinome Fox-1` como entidade; `alias_targets` vazio no compiler v1 |
| live-static_preferences-r1-e1397902 | B | `allowed: Alex Costa` vs entidades `Alex`, `Dana`, `Chris` |
| live-episodic_meeting-r1-f60685a4 | C | `conversation` vs expected `meeting` |
| live-bootstrap_panorama-r1-ed9e2f67 | A | Passa expected; eventos estáticos dropados |

Detalhe completo: `artifacts/calibration/compiler-v1-live-audit-detail.json`.

---

## 3. Contrato `ExtractorOutputV14`

### 3.1 Envelope LLM

```ts
interface ExtractorOutputV14 {
  schema_version: '1.4';

  entity_mentions: ExtractedEntityMention[];
  aliases: ExtractedAlias[];
  events: ExtractedEvent[];
  correction_signals: ExtractedCorrectionSignal[];
  assertions: ExtractedAssertion[];
  tasks: ExtractedTask[];
  clarification_candidates: ClarificationCandidate[];

  review_hints: ReviewHint[];
  extraction_notes: string[];
}
```

**Não incluir no JSON da LLM:**

- `inbox_item_id` (anexado pelo pipeline)
- `requires_review`, `review_reasons` (calculados pelo Memory Compiler v2 + Clarification Manager)
- `entity_id` em qualquer campo

### 3.2 `ExtractedEntityMention`

```ts
interface ExtractedEntityMention {
  mention_text: string;
  suggested_entity_type: EntityType;
  source_excerpt: string;
  confidence: number;
}
```

### 3.3 `ExtractedAlias`

```ts
interface ExtractedAlias {
  alias: string;
  target_reference: string;
  negated_former_references: string[];
  source_excerpt: string;
  confidence: number;
}
```

### 3.4 `ExtractedEvent`

```ts
interface ExtractedEventEntityReference {
  entity_reference: string;
  relation_type:
    | 'participant'
    | 'subject'
    | 'mentioned'
    | 'sender'
    | 'recipient'
    | 'other';
  role: string | null;
}

interface ExtractedEvent {
  event_kind:
    | 'meeting'
    | 'confirmation'
    | 'decision'
    | 'document_sent'
    | 'presentation'
    | 'commitment'
    | 'change'
    | 'correction'
    | 'other';
  title: string;
  source_excerpt: string;
  occurred_at: string | null;
  episodic_confidence: number; // 0..1
  related_entities: ExtractedEventEntityReference[];
}
```

### 3.5 `ExtractedCorrectionSignal`

```ts
interface ExtractedCorrectionSignal {
  correction_type:
    | 'replace_subject'
    | 'replace_object'
    | 'invalidate_assertion'
    | 'invalidate_alias'
    | 'other';
  previous_reference: string | null;
  current_reference: string | null;
  source_excerpt: string;
  source_block_reference: string | null;
  confidence: number;
}
```

Pipeline liga `source_block_reference` ao `correction_id` real após promote.

### 3.6 `ExtractedAssertion`

Objetivo: visão geral e estado vigente de projetos, entidades e decisões.

```ts
interface ExtractedAssertion {
  assertion_kind:
    | 'fact'
    | 'hypothesis'
    | 'opinion'
    | 'decision'
    | 'commitment'
    | 'status_update'
    | 'other';

  subject_reference: string;
  predicate: string;
  object_reference: string | null;
  value_text: string | null;

  related_entity_references: string[];

  source_excerpt: string;
  source_block_reference: string | null;
  confidence: number;
}
```

### 3.7 `ExtractedTask`

Objetivo: tarefa, projeto, responsável, status, bloqueio e prazo.

```ts
interface ExtractedTask {
  title: string;

  task_kind:
    | 'follow_up'
    | 'delivery'
    | 'decision'
    | 'review'
    | 'external_action'
    | 'other';

  status_signal:
    | 'open'
    | 'completed'
    | 'cancelled'
    | 'blocked'
    | 'unknown';

  assignee_reference: string | null;
  target_reference: string | null;
  project_reference: string | null;

  due_at: string | null;
  blocked_reason: string | null;

  source_excerpt: string;
  source_block_reference: string | null;
  confidence: number;
}
```

**Materialidade de prazo (`update_due_date`):**

- `due_at` literal emitido pelo extrator (ex.: `"sexta-feira"`, `"sexta"`) é **preservado** em `CompiledTaskV2.dueAt` sem conversão para timestamp absoluto.
- Clarificações `ambiguous_date` sobre expressões relativas são **non_blocking** quando a tarefa foi resolvida por contexto e `due_at` está preenchido.
- Normalização absoluta de datas é etapa determinística futura (fora do Clarification Manager v2).

### 3.8 `ReviewHint` e clarificações

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

interface ClarificationCandidate {
  target_type: 'entity' | 'event' | 'assertion' | 'task' | 'external_action' | 'other';
  target_reference: string;
  issue_type: ClarificationIssueType; // enum estrito — sem sinônimos
  question: string;
  reason: string; // texto livre para nuance
  priority: 'low' | 'medium' | 'high';
  blocking_scope: 'none' | 'knowledge_confirmation' | 'task_execution' | 'external_action';
  suggested_answers: string[];
  source_excerpt: string;
  source_block_reference: string | null;
  confidence: number;
}

interface ReviewHint {
  issue_type:
    | 'ambiguous_identity'
    | 'ambiguous_entity_type'
    | 'possible_contradiction'
    | 'low_confidence_event'
    | 'unresolved_reference'
    | 'other';
  target_reference: string | null;
  reason: string;
  source_excerpt: string;
  confidence: number;
}
```

**Taxonomia canônica (Bloco 4E):**

- `clarification_candidates[].issue_type` aceita **somente** valores do enum `ClarificationIssueType`.
- Sinônimos livres (ex.: `missing_assignment_and_deadline`) são **rejeitados** pelo schema Zod/OpenAI strict.
- Ausência simultânea de responsável e prazo → `missing_assignee_or_due_date`.
- Sem categoria adequada → `issue_type = other`; detalhe em `reason`.
- `other` → **blocking por padrão** no Clarification Manager v2 até regra explícita.

- LLM **sugere** via `review_hints` e `clarification_candidates`.
- **Memory Compiler v2 + Clarification Manager** produzem `requires_review` e `review_reasons` finais.
- **Decisão final pós-materialidade:** `ClarificationManagerV2.classify()` separa clarificações em `blocking`, `non_blocking` e `discarded`. `finalDecision` = `accepted` quando `blocking.length === 0`, independente de `compiler.decision` preliminar.
- Enrichment em `create` (`missing_due_date`, `missing_assignee`, `missing_assignee_or_due_date`, `unclear_scope` sob guardas materiais) → `non_blocking`; não impede registro da tarefa.

Ver também: [`docs/regras_canonicas_ingestao_contexto_clarificacoes_v1.md`](regras_canonicas_ingestao_contexto_clarificacoes_v1.md).

---

## 4. Regra universal de referências textuais

```text
LLM extrai referências textuais (mention_text, *_reference)
  → Memory Resolver tenta resolver entity_id canônico
  → Memory Compiler v2 valida consistência
  → referência não resolvida → clarification candidate ou unresolved explícito
```

**A LLM nunca retorna `entity_id`.**

Campos sujeitos à regra:

| Campo |
|-------|
| `aliases.target_reference` |
| `aliases.negated_former_references[]` |
| `events.related_entities[].entity_reference` |
| `assertions.subject_reference` |
| `assertions.object_reference` |
| `assertions.related_entity_references[]` |
| `tasks.assignee_reference` |
| `tasks.target_reference` |
| `tasks.project_reference` |
| `correction_signals.previous_reference` / `current_reference` |

---

## 5. `source_block_reference`

O **EffectiveInputBuilder** (fase implementação) marca blocos deterministicamente:

```text
[SOURCE_BLOCK:raw]
...

[SOURCE_BLOCK:correction:<uuid>]
...
```

A LLM **replica apenas** identificadores permitidos no prompt. **Proibido** inventar:

- “parágrafo 3”
- “bloco anterior”
- “trecho acima”

Aplica-se a: `correction_signals`, `assertions`, `tasks`, `clarification_candidates` quando referenciam bloco.

---

## 6. Campos removidos vs v1.3

| v1.3 | v1.4 |
|------|------|
| `inbox_item_id` no output LLM | Pipeline anexa |
| `entities[].name` | `entity_mentions[].mention_text` |
| `entities[].aliases[]` | `aliases[]` top-level |
| `events[].event_type` | `events[].event_kind` |
| `events[].description` (eixo principal) | `title` + `source_excerpt` |
| `events[].entity_names[]` | `related_entities[]` |
| `requires_review`, `review_reasons` (LLM) | `review_hints` + compiler final |
| Adapter / leitores v1.3 no runtime | — |

---

## 7. Memory Compiler v2 (design)

```text
ExtractorOutputV14
  → Memory Compiler v2 (valida, filtra, resolve referências)
  → Clarification Manager
  → Pipeline transacional + RPCs (inalterados em conceito)
```

| Entrada v1.4 | Ação v2 |
|--------------|---------|
| `entity_mentions` | Resolver → entidades compiladas com `entity_id` |
| `aliases` | Resolver `target_reference`; não criar entidade para alias |
| `events` | Gate `episodic_confidence`; materializar `event_entities` de `related_entities` |
| `correction_signals` | Supersede vigente por bloco |
| `assertions` / `tasks` | Resolver referências; status vigente |
| `review_hints` | Input para review final (não persistir como decisão LLM) |

### 7.1 Extension point (não implementar agora)

```ts
interface CompilerDecision {
  status:
    | 'accepted'
    | 'rejected'
    | 'needs_clarification'
    | 'needs_llm_review';
  reasons: string[];
  confidence: number;
}
```

Sem segunda LLM nesta fase. `needs_llm_review` reserva revisão futura.

---

## 8. Banco de dados (greenfield)

### 8.1 Recomendação principal

**Criar novo projeto Supabase de homologação greenfield.**

Manter projeto atual temporariamente só como referência histórica de comparação.

Motivos:

- Evitar resíduos de migrations 001–014
- Evitar constraints provisórias e backfills
- Validar baseline limpa
- Comparar schema antigo vs canônico lado a lado

### 8.2 Estrutura de migrations (quando implementar)

```text
supabase/migrations_archive/pre-greenfield/   ← 001–014 histórico

supabase/migrations/
  001_greenfield_baseline.sql
  002_greenfield_rpcs.sql
  003_greenfield_seeds.sql
```

**Não** empilhar `015_greenfield` obrigatoriamente sobre 001–014 no projeto novo.

### 8.3 Reset homologação

- Não preservar dados atuais de homologação no projeto greenfield.
- Seeds controlados (ex. Genius Hotels) via `003_greenfield_seeds.sql`.
- [`scripts/reset-test-data.ts`](../scripts/reset-test-data.ts) e [`scripts/verify-env.ts`](../scripts/verify-env.ts) alinhados na fase DB.
- Atualizar [`docs/schema-current.md`](schema-current.md) com fotografia greenfield.

`raw_model_output` permanece `text` (JSON v1.4); versionamento por `schema_version` / `extractor_version` na run.

---

## 9. Fixtures e calibração

| Dataset | Papel |
|---------|--------|
| `data/calibration/compiler-v1/` | Baseline v1.3 — regressão histórica |
| `data/calibration/extractor-v1.4/` | Canônico futuro (9+ casos direcionados) |
| `artifacts/calibration/live-captures/` | 80 capturas v1.3 para comparação |

Modo compare offline: re-run v1.3 em artifacts — **não** no pipeline produtivo.

---

## 10. JSON Schema draft (resumo)

`schema_version` const `"1.4"`. Root `additionalProperties: false`.

Arrays obrigatórios (podem ser vazios): `entity_mentions`, `aliases`, `events`, `correction_signals`, `assertions`, `tasks`, `clarification_candidates`, `review_hints`, `extraction_notes`.

Enums fechados conforme tipos acima. `episodic_confidence` number 0–1.

Draft TypeScript completo: [`docs/drafts/extractor-v1.4.types.ts`](drafts/extractor-v1.4.types.ts).

---

## 11. Rollout (implementação futura)

1. Auditar 80 capturas (feito — doc-only)
2. Finalizar spec (este documento)
3. Implementar extractor-v1.4
4. Implementar Memory Compiler v2
5. Novo Supabase homolog + baseline migrations
6. Dataset fixo v1.4
7. Live calibration (10× categoria)
8. Thresholds
9. **Enforce** compiler
10. Importar bootstrap pessoal

---

## 12. Semantic quality gate (Bloco 4F)

Implementação: `src/calibration/extractor-v1.4/semantic-gate.ts`, runner `npm run test:extractor:v1.4:live`.

Capturas **somente** da execução atual: `artifacts/calibration/extractor-v1.4-live-runs/<run_id>/`.

Métricas com denominador zero → `status: not_applicable`, `value: null`, `applicable_runs: 0` (não contam como falha).

| Métrica | Limite |
|---------|--------|
| `structured_output_validity` | = 1.00 |
| `alias_target_recall` | ≥ 0.95 |
| `entity_precision` | ≥ 0.95 (quando aplicável) |
| `event_kind_match` | ≥ 0.90 |
| `negation_error_rate` | = 0 |
| `alias_as_entity_rate` | = 0 |
| `preference_to_event_rate` | = 0 (somente runs `static_preferences`) |
| `description_corruption_rate` | = 0 |
| `task_signal_emission_recall` | ≥ 0.95 |
| `context_resolution_success_rate` | ≥ 0.95 |
| `task_recall` | ≥ 0.95 |
| `project_status_update_recall` | = 1.00 |
| `source_block_reference_validity` | = 1.00 |
| `true_ambiguity_clarification_recall` | = 1.00 |
| `false_blocking_clarification_rate` | ≤ 0.05 |
| `clarification_materiality` | blocking / non_blocking / discarded (informativo) |

**Status calibração:**

| Marco | Status | Evidência |
|-------|--------|-----------|
| Contextual (4E) | **approved** | `task_signal_emission_recall`, `context_resolution_success_rate`, `false_blocking_clarification_rate` = 0 |
| Taxonomia `issue_type` + materialidade | **approved** | fixed + context calibration |
| Contrato `status_update` | **approved** | compiler `status_update_missing_value`; prompt mínimo |
| **Semantic gate amplo (4F)** | **approved** | run `v14-live-2026-06-03T00-20-08-750Z-88484fa2` |

### 12.1 Gate amplo final (aprovado 2026-06-03)

| Campo | Valor |
|-------|--------|
| `run_id` | `v14-live-2026-06-03T00-20-08-750Z-88484fa2` |
| Escopo | 13 categorias × 5 repetições = **65 runs** live |
| Case pass rate | **64/65** (98,5%) |
| Gate `pass` | **true** (exit 0) |
| Capturas | `artifacts/calibration/extractor-v1.4-live-runs/v14-live-2026-06-03T00-20-08-750Z-88484fa2/` |
| Relatórios | `extractor-v1.4-semantic-gate-report.json`, `extractor-v1.4-semantic-gate-summary.md` |

**Resultados agregados (thresholds atendidos):**

```text
structured_output_validity = 1.00
alias_target_recall = 1.00
entity_precision = 1.00
event_kind_match = 1.00
negation_error_rate = 0
alias_as_entity_rate = 0
preference_to_event_rate = 0
description_corruption_rate = 0
task_signal_emission_recall = 1.00
context_resolution_success_rate = 1.00
task_recall = 1.00
project_status_update_recall = 1.00
source_block_reference_validity = 1.00
true_ambiguity_clarification_recall = 1.00
false_blocking_clarification_rate = 0
```

**Clarification materiality (informativo):** blocking 5 · non_blocking 7 · discarded 20.

### 12.2 Limitação conhecida (não bloqueante)

| Categoria | Residual | Classificação |
|-----------|----------|---------------|
| `static_preferences` | 1/5 run: LLM classificou preferência como `assertion_kind: fact` em vez de `opinion` (`live-v14-static_preferences-r3-0f80170c`) | Variabilidade de taxonomia no extrator; `finalDecision` permaneceu `accepted`; **não corrigir no gate 4F** |

### 12.3 Próximo bloco

**Bloco 5 — normalização determinística de datas relativas** (planejado; ver `docs/bloco-5-normalizacao-datas-relativas-plano.md`). Escopo inicial: `task_signals[].due_at` apenas.

---

## 12bis. Contrato `status_update` (consolidado)

Para `assertion_kind = status_update`:

| Campo | Semântica |
|-------|-----------|
| `subject_reference` | Entidade ou projeto afetado |
| `predicate` | Dimensão atualizada (ex.: `"status"`) |
| `value_text` | Novo valor vigente — **obrigatório e não vazio** |

Exemplo: *Projeto Atlas está em risco* → `predicate = "status"`, `value_text = "em risco"`. Não colocar o novo status dentro de `predicate`.

**Validação (Memory Compiler v2, calibração):** se `value_text` null/vazio → não promover assertion; emitir clarificação compiler `status_update_missing_value`; `decision` → `needs_clarification`. Sem parser de frases nem correção automática de predicates livres.

---

## 13. Thresholds enforce (legado compiler-v1)

| Métrica | Limite |
|---------|--------|
| `alias_target_recall` | ≥ 0.95 |
| `entity_precision` (live) | ≥ 0.95 |
| `event_kind_match` | ≥ 0.90 |
| `negation_error_rate` | = 0 |
| `alias_as_entity_rate` | = 0 |
| `preference_to_event_rate` | = 0 |
| `description_corruption_rate` | = 0 |
| `false_clarification_rate` | ≤ 0.05 |
| Pipeline smoke | verde |

---

## 14. Testes planejados

| Camada | Escopo |
|--------|--------|
| Unit | `audit-detail`, parse Zod v1.4, regras compiler v2 |
| Calibration | `data/calibration/extractor-v1.4/manifest.json` |
| Integration | pipeline + RPCs pós-greenfield DB |
| Compare | `artifacts/calibration/v13-vs-v14-diff.json` (offline) |

---

## 15. Riscos

| Risco | Mitigação |
|-------|-----------|
| Variabilidade LLM em `event_kind` | `episodic_confidence` + calibração live |
| Referências não resolvidas | Clarification + `needs_llm_review` reservado |
| `source_block_reference` inventado | EffectiveInputBuilder + validação no compiler |
| Métricas live mal calibradas | Contratos `expected` v1.4 com `target_reference` |

---

## 16. Validação deste pacote doc-only

| Comando | Resultado (2026-06-02) |
|---------|------------------------|
| `npm run lint` | OK |
| `npm test` | 101 passed |
| `npm run build` | OK |
| `npm run audit:live-variability` | OK — 80 capturas |

---

## 17. Critérios de aceite (pacote doc-only)

- [x] `compiler-v1-live-audit-detail.json` — 80 entradas
- [x] `extractor-v1.4-spec.generated.md` gerado
- [x] `docs/extractor-v1.4-spec.md` curado
- [x] Contratos completos Assertion, Task, ReviewHint
- [x] Regras de referência e `source_block_reference`
- [x] Recomendação novo Supabase greenfield
- [x] Sem runtime v1.4 / compiler v2 / migrations / enforce

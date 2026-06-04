# Segundo Cérebro Pessoal — Backlog v1.2 (incremental)

**Versão:** 1.2  
**Data:** 02/06/2026  
**Escopo:** complemento ao [backlog v1.0](backlog_segundo_cerebro_pessoal_v1.md) — calibração extractor v1.4 / compiler v2.

---

## Calibração extractor v1.4 — status

| Bloco | Descrição | Status |
|-------|-----------|--------|
| 4A–4C | Contrato, compiler v2, dataset fixo | done |
| 4D | Contexto de ingestão (fixture) | done |
| 4E | Taxonomia `issue_type` + materialidade + calibração contextual live | **done** |
| 4F | Quality gate semântico amplo + segregação por run | **done** (approved 2026-06-03) |
| 5A | TemporalNormalizer puro + tipos + testes | **done** |
| 5B | Calibração offline versionada + baseline | **done** |
| 5C | Wire Memory Compiler v2 + runners v1.4 | **done** |
| 6A–6E | Greenfield DB + PersistenceV2 + shadow wire | **done** |
| 6F | Hardening pré-apply (flags, RPCs, apply script) | **done** |
| 6G | Hardening pós-smoke (promote blocking_scope + missing_task_target compiler) | **done** |

### 4E — aprovado

- `first_contact_task` × 20 → 20/20  
- Regressão contextual 3 × 10 → 30/30  
- `task_signal_emission_recall`, `context_resolution_success_rate`, `task_recall`, `source_block_reference_validity`, `true_ambiguity_clarification_recall` → 1.00  
- `false_blocking_clarification_rate` → 0  

### 4F — aprovado (2026-06-03)

- `run_id`: `v14-live-2026-06-03T00-20-08-750Z-88484fa2`  
- 13 × 5 = 65 runs; case pass 64/65; **todos os thresholds** atendidos; `pass: true`  
- Capturas: `artifacts/calibration/extractor-v1.4-live-runs/v14-live-2026-06-03T00-20-08-750Z-88484fa2/`  
- Limitação conhecida: `static_preferences` 1/5 (`fact` vs `opinion`) — não bloqueante  

### Próximo passo

**Pipeline smoke greenfield** — após hardening 6G (promote + missing_task_target); apply completo via `db:apply-greenfield-schema` inclui RPCs atualizadas.

### Hardening 6G — promote + missing_task_target (2026-06-03)

- `task_execution` → não bloqueia promote; bloqueia execução da tarefa
- `knowledge_confirmation` / `external_action` → bloqueiam promote
- Compiler v2: fornecedor genérico → `missing_task_target` determinístico
- Probes: `verify-env`, `test-greenfield-rpcs.sql` (8–10)

### Dívidas prioritárias antes de enforce (Bloco 6F)

- `persistCandidates` ainda usa múltiplos inserts app-side sem transação única;
- `source_block_reference` parcial em clarifications e inbox_item_entities;
- `correctionId` ainda não propagado no shadow persist;
- `entity_resolution_logs` ainda não escritos pelo runtime v2;
- dupla chamada LLM temporária em homologação.

### Explicitamente fora de escopo (próximo bloco infra)

- Supabase greenfield / migrations  
- Persistência `CompiledMemoryV2`  
- Troca de runtime produtivo / enforce  
- Bootstrap pessoal  
- Segunda LLM  
- Normalização em `events`, `assertions`, compromissos  

---

## BLG-v12-4F — Semantic quality gate

**Prioridade:** P0  
**Status:** **done** (approved)

**Evidência:** `extractor-v1.4-semantic-gate-report.json` — `pass: true`, run `v14-live-2026-06-03T00-20-08-750Z-88484fa2`.

---

## BLG-v12-5A — TemporalNormalizer puro

**Prioridade:** P0  
**Status:** **done**

**Entrega:** tipos, normalizer determinístico, regras canônicas, 50 fixtures, testes unitários sem OpenAI/DB.

**Regras:** [`docs/regras_canonicas_normalizacao_temporal_v1.md`](regras_canonicas_normalizacao_temporal_v1.md)

---

## BLG-v12-5B — Calibração offline TemporalNormalizer

**Prioridade:** P0  
**Status:** **done**

**Entrega:** runner `calibrate:temporal:normalizer`, baseline `v1.0.0-baseline.json`, relatórios em `artifacts/calibration/`, compare semântico `--compare-baseline`.

**Casos:** `data/calibration/temporal-normalizer/cases.json` (54).

---

## BLG-v12-5C — Wire Memory Compiler v2

**Prioridade:** P0  
**Status:** **done**

**Entrega:** `dueAtTemporal`, `temporalAnchor`, runners v1.4, shadow log seguro, testes de integração.

---

## BLG-v12-5 — Normalização determinística de datas relativas (umbrella)

**Prioridade:** P0  
**Status:** **done** (5A + 5B + 5C)  

**Plano técnico:** [`docs/bloco-5-normalizacao-datas-relativas-plano.md`](bloco-5-normalizacao-datas-relativas-plano.md)

**Escopo inicial:** `task_signals[].due_at` (literal preservado + normalização derivada).

**Critério de aceite (5A):** suite determinística sem OpenAI — **atendido**.

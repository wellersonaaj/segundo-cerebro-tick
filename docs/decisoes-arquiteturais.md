# Decisões arquiteturais

Registro incremental de decisões estruturais do MVP Segundo Cérebro Tick.

---

## DA-001 — `entity_aliases` como única fonte persistida de aliases

**Data:** 2026-05-31  
**Status:** Aprovada

- `entities` guarda apenas a entidade canônica (nome, tipo, status).
- `entity_aliases` é a **única** fonte de verdade persistida para aliases.
- Coluna legada `entities.aliases` removida (migration 010).
- REST (`GET /entities/:id`, `GET /memory/search`) e MCP (`get_entity_details`, busca por alias) **calculam** aliases via join.
- Sem double-write: `EntityUpsertService` persiste aliases somente em `entity_aliases`.
- O campo `ExtractedEntity.aliases` permanece no output OpenAI (contrato de extração).

---

## DA-002 — Linking bootstrap orientado por `source_channel`

**Data:** 2026-05-31  
**Status:** Aprovada

- Não depender de `event_type === 'document_snapshot'` escolhido pelo modelo.
- Para `source_channel = bootstrap`: após upsert, vincular **todas** entidades canônicas finais únicas ao **evento principal** (`relation_type = mentioned`).
- Seleção determinística do evento principal:
  1. único evento;
  2. `document_snapshot`;
  3. `profile_created`;
  4. maior `confidence`;
  5. primeiro persistido.
- Log: `bootstrap_primary_event_selected`.
- Inclui todos os tipos de entidade (person, company, location, etc.).

---

## DA-003 — Uso cotidiano mantém linking contextual

**Data:** 2026-05-31  
**Status:** Aprovada

- Para `source_channel != bootstrap`: linking heurístico por evento (entity_names + menção em excerpt/description).
- Não aplicar linking amplo a todas entidades extraídas.

---

## DA-004 — Assertions bootstrap: sem limite artificial de 15

**Data:** 2026-05-31  
**Status:** Aprovada (investigação concluída)

- Auditoria: não há `maxItems = 15`, `slice(0, 15)` nem truncamento na persistência.
- Omissões observadas (ex.: 15 assertions no arquivo 01) vêm da **extração seletiva do modelo**.
- Teto de segurança: `BOOTSTRAP_MAX_ASSERTIONS = 100` com aviso `possible_assertion_truncation` se atingido.
- Nota informativa `bootstrap_assertion_completeness_review` em todo processamento bootstrap.

---

## DA-005 — Pipeline de extração versionado

**Data:** 2026-06-01  
**Status:** Aprovada

- `inbox_extraction_runs` como unidade auditável de processamento.
- Artefatos derivados passam por `record_status = candidate` antes de promoção atômica via RPC `promote_extraction_run`.
- `inbox_item_entities` como proveniência universal inbox↔entidade (independe de events).

---

## DA-006 — Registry lifecycle com candidate reuse

**Data:** 2026-06-01  
**Status:** Aprovada

- `entities.registry_status` e `entity_aliases.registry_status`: candidate | active | superseded.
- Resolver e busca só enxergam `active`.
- Reuse: entity/alias `active` → reuse; `candidate` órfão (run failed/discarded) → reuse; senão create candidate.
- Unicidade global mantida (`normalized_name`, `normalized_alias`).

---

## DA-007 — Promoção de registry por evidência

**Data:** 2026-06-01  
**Status:** Aprovada

- Promoção de entity/alias para `active` baseada em evidência (`inbox_item_entities` + `entity_alias_evidences`), não apenas `created_by_extraction_run_id`.
- `event_entities` deriva lineage do event pai (sem colunas redundantes de run).

---

## DA-008 — Single-flight e stale protection

**Data:** 2026-06-01  
**Status:** Aprovada

- `start_extraction_run`: bloqueia run concorrente (`RUN_ALREADY_IN_PROGRESS`).
- `promote_extraction_run`: lock inbox; se `latest_extraction_run_id ≠ p_run_id` → `RUN_STALE`, run marcado `discarded`.
- `fail_extraction_run`: stale-aware; só atualiza inbox se run ainda é latest.
- RPCs: `REVOKE PUBLIC`; `GRANT EXECUTE TO service_role`.

---

## DA-009 — EffectiveInputBuilder para correction/reprocess

**Data:** 2026-06-01  
**Status:** Aprovada

- `raw_content` imutável; correções append-only em `corrections`.
- Input efetivo: `raw_content` + blocos `[CORREÇÃO]` em ordem cronológica.
- `input_content_hash` por run para auditoria.
- Versões separadas: `schema_version`, `prompt_version`, `extractor_version`, `model_name`.

---

## DA-010 — processing_status vs has_active_memory

**Data:** 2026-06-01  
**Status:** Aprovada

- `processing_status`: status da **última tentativa** (ex.: `failed` após reprocess falho, mesmo com memória active anterior).
- `has_active_memory` (REST): derivado de `active_extraction_run_id IS NOT NULL`.
- `inbox_items.extractor_version`: espelha `run.extractor_version` na promoção (nunca `schema_version`).
- `corrections.status` (retração): **adiado** nesta entrega.

# Schema greenfield v2 (CompiledMemoryV2)

**Versão:** greenfield v2 · **Bloco 6**  
**Migrations:** `20260602100000_greenfield_baseline.sql`, `20260602100001_greenfield_rpcs.sql`, `20260602100002_greenfield_seeds.sql`  
**Histórico:** migrations 001–014 arquivadas em `supabase/migrations_archive/pre-greenfield/`

## Pipeline de memória

```text
inbox_items (imutável — raw_content nunca sobrescrito)
  → corrections (append-only, SOURCE_BLOCK)
  → inbox_extraction_runs (started | validated | promoted | failed | discarded)
    → parsed_output (ExtractorOutputV14)
    → compiled_output (CompiledMemoryV2 + finalDecision)
  → artefatos record_status=candidate
  → promote_extraction_run RPC
  → artefatos record_status=active
  → task_mutations aplicadas à projeção tasks
```

## inbox_items

- `source_reference`, `metadata jsonb` — proveniência externa
- `processing_status` — última tentativa
- `active_extraction_run_id` / `latest_extraction_run_id`
- Trigger `INBOX_RAW_CONTENT_IMMUTABLE` em updates

## inbox_extraction_runs

Versões obrigatórias: `schema_version`, `prompt_version`, `extractor_version`, `model_name`, `normalizer_version`, `compiler_version`.

Payloads: `raw_model_output text`, `parsed_output jsonb`, `compiled_output jsonb`.

## Registry

- `entities.registry_status`: candidate | active | superseded | rejected
- `entity_aliases.registry_status`: idem
- Sem coluna legada `entities.status`

## Tasks

- `tasks` — projeção global (estado atual)
- `task_mutations` — histórico imutável por operação (`create`, `update_*`, `complete`, `cancel`)
- Colunas temporais `due_at_*` + `due_at_evidence jsonb`

## Assertions v2

- `assertion_kind`, `subject_reference`, `predicate`, `value_text`
- `status_update` vigente: `is_current=true` + índice único `(subject_entity_id, predicate)`

## Clarifications

- Enum `issue_type` validado na app (v1.4)
- `materiality`: blocking | non_blocking (discarded não persiste)

## RPCs

- `start_extraction_run(..., normalizer_version, compiler_version)`
- `promote_extraction_run` — supersede + apply task_mutations + activate registry; **nenhum** `blocking_scope` impede promote (S2); clarifications pendentes permanecem `active` + `status = pending` após promote
- `fail_extraction_run` — candidates → rejected; registry candidates do run → rejected
- `apply_task_mutations_for_run` — `create` livre; demais operações exigem `task_id` existente em `tasks`

## Flags runtime (Bloco 6F)

Combinações válidas em homologação greenfield:

```text
GREENFIELD_SCHEMA=true
EXTRACTOR_V14_SHADOW_ENABLED=true
PERSIST_COMPILED_MEMORY_V2=true
```

Combinações bloqueadas em `loadEnv()`:

| Combinação | Erro |
|------------|------|
| `GREENFIELD=true` + `SHADOW=false` | `GREENFIELD_SCHEMA_REQUIRES_EXTRACTOR_V14_SHADOW` |
| `GREENFIELD=true` + `PERSIST=false` | `GREENFIELD_SCHEMA_REQUIRES_PERSIST_COMPILED_MEMORY_V2` |
| `GREENFIELD=false` + `PERSIST=true` | `PERSIST_COMPILED_MEMORY_V2_REQUIRES_GREENFIELD_SCHEMA` |

## Dívidas prioritárias (antes de enforce)

- `persistCandidates` ainda usa múltiplos inserts app-side sem transação única;
- `source_block_reference` parcial em clarifications e inbox_item_entities;
- `correctionId` ainda não propagado no shadow persist;
- `entity_resolution_logs` ainda não escritos pelo runtime v2;
- dupla chamada LLM temporária em homologação.

## Instalação

```bash
ALLOW_GREENFIELD_SCHEMA_APPLY=true \
GREENFIELD_SCHEMA_APPLY_CONFIRM=<hostname> \
SUPABASE_DB_PASSWORD='...' npm run db:apply-greenfield-schema
npm run verify:env
```

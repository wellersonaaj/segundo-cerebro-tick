# Implementation Notes

## Decisões tomadas

### Repositório base

O diretório `segundo-cerebro-tick` continha um scaffold Next.js vazio. Foi **substituído** por API Node/Fastify conforme especificação do MVP, sem descartar histórico git além dos arquivos do template removidos explicitamente.

### Stack

- **Fastify 5** (em vez de Express) — leve, adequado ao Railway
- **OpenAI Responses API** com JSON Schema estrito (`extractor-v1.3`)
- **Supabase JS** com service role apenas no servidor
- **Vitest** para testes; mocks determinísticos por padrão

### Modelo OpenAI

`.env.example` e `env.ts` usam `gpt-5-mini` como padrão (sobrescrevível via `OPENAI_MODEL`).

### Correções (estratégia)

1. `inbox_items.raw_content` **nunca** é alterado.
2. Cada correção é append em `corrections`.
3. Registros derivados anteriores: `events.status=superseded`, `assertions.record_status=superseded`, `tasks.status=superseded`.
4. Reprocessamento com texto `raw_content + [CORREÇÃO] ...`.
5. Novos registros referenciam `correction_id`.
6. Consultas filtram registros ativos.

### Memory Resolver

Ordem: exact name → exact alias → partial name → partial alias → menções recentes.

Clarificações `ambiguous_entity_type` / `ambiguous_entity_identity` removidas quando entidade resolvida por alias/nome.

Termos genéricos (`fornecedor`, `cliente`, …) não geram entidade nem resolução.

### Segurança

- RLS habilitado em todas as tabelas (sem políticas públicas no MVP; acesso via service role no backend).
- `raw_content` tratado como não confiável no prompt.
- Sem DELETE definitivo na API.

### Migrations

`001_core.sql` — tabelas principais + policies seed.  
`002_clarifications_and_resolution.sql` — aliases, resolution logs, clarifications, corrections + FKs.

Se o Supabase já tiver schema da Fase 1A, aplique apenas objetos ausentes manualmente ou adapte migrations (não sobrescrever dados).

## Busca textual (limitação conhecida)

A busca textual atual usa ilike e pode exigir substring contígua. Exemplo: "integração Genius" pode não encontrar "integração da Genius". Melhoria futura: busca textual por tokens ou busca híbrida.

## Bootstrap do panorama inicial

Importação via `npm run import:bootstrap` limitada a `BOOTSTRAP_MAX_CHARS` (default 50.000). Sem chunking automático — dividir manualmente arquivos grandes antes de importar.

Aliases explícitos extraídos pelo modelo (`extractor-v1.3`) são persistidos **somente** em `entity_aliases` via `EntityUpsertService`. A coluna legada `entities.aliases` foi removida (migration **010**); REST e MCP **calculam** aliases via join com `entity_aliases`. O campo `ExtractedEntity.aliases` permanece no contrato OpenAI.

Migration **008** adiciona `inbox_items.processed_at`, `event_entities.relation_type` e expande `issue_type` para conflitos de alias. **009** alinha `event_entities.relation_type` como `NOT NULL DEFAULT 'mentioned'`. **010** remove `entities.aliases`.

### Linking bootstrap vs uso cotidiano

Para `source_channel = bootstrap`, após upsert de entidades o pipeline escolhe **deterministicamente** um evento principal e vincula **todas** as entidades canônicas finais únicas a ele (`relation_type = mentioned`, `role = null`). Estratégia do evento principal:

1. único evento → usa esse;
2. múltiplos → `document_snapshot` > `profile_created` > maior `confidence` > primeiro persistido.

Log estruturado: `bootstrap_primary_event_selected`.

Para `source_channel != bootstrap`, mantém linking contextual/heurístico por evento (nomes em `entity_names`, menção em excerpt/description).

### Assertions no bootstrap

Não há limite artificial de 15 no schema, prompt ou persistência (`maxItems`, `slice`, sanitização). As 15 assertions observadas na importação do arquivo 01 refletem **extração seletiva do modelo**, não truncamento silencioso.

Teto de segurança documentado: `BOOTSTRAP_MAX_ASSERTIONS = 100` — se atingido, gera `possible_assertion_truncation` em `processing_notes` / `review_reasons`. Todo bootstrap recebe nota `bootstrap_assertion_completeness_review` para revisão manual de completude.

Vínculos evento–entidade usam `relation_type = 'mentioned'` por padrão (obrigatório no banco). O campo `role` permanece nullable para papéis específicos quando conhecidos.

## Pipeline de memória versionado (migrations 011–014)

Fluxo: `start_extraction_run` → extract → candidates → `promote_extraction_run` (ou `fail_extraction_run`).

### Semântica de status

- `processing_status`: status da **última tentativa** (`failed` mesmo quando memória active anterior existe).
- `has_active_memory` (REST): derivado de `active_extraction_run_id IS NOT NULL`.
- `inbox_items.extractor_version`: espelha `run.extractor_version` na promoção (nunca `schema_version`).

### Proveniência

- `inbox_item_entities`: ligação universal inbox↔entidade (independe de events).
- `entity_alias_evidences`: evidência para promoção de alias no registry.
- Registry: `candidate | active | superseded`; resolver só enxerga `active`.

### Candidate reuse

- Entity/alias `active` → reuse.
- `candidate` órfão (run failed/discarded) → reuse no próximo run.
- Promoção de registry por evidência (IIE + alias_evidences), não só `created_by_extraction_run_id`.

### Correção e reprocess

- `EffectiveInputBuilder`: `raw_content` + correções cronológicas.
- Correção/reprocess disparam novo run; falha preserva memória active anterior.
- Single-flight: `RUN_ALREADY_IN_PROGRESS`; stale: `RUN_STALE` → run `discarded`.

Ver fotografia consolidada em [schema-current.md](./schema-current.md).

## Checkpoint C — fluxo n8n + Telegram (preparação)

O processamento LLM **não** deve atrasar a confirmação HTTP ao Telegram. Ordem correta no n8n:

```text
Telegram → n8n
→ Postgres INSERT inbox_item (processing_status = pending)
→ Respond to Webhook HTTP 200        ← imediato, antes da LLM
→ IF inserted = true
→ POST /internal/inbox-items/{{ $json.id }}/process
  (header X-Internal-Processing-Secret)
```

O backend processa de forma assíncrona via endpoint interno; falhas de LLM retornam 500 no POST interno, sem impactar o 200 já enviado ao Telegram.

## Segurança mínima (revisão homologação)

| Requisito | Status |
|-----------|--------|
| `SUPABASE_SERVICE_ROLE_KEY` apenas em `src/db/supabase.ts` (servidor) | OK — não exposta em rotas nem MCP client |
| Endpoint SQL livre | OK — inexistente |
| Tool MCP SQL livre | OK — somente 6 tools de leitura tipadas |
| `raw_content` não confiável | OK — regra no prompt + sem execução de instruções embutidas |
| Exclusão definitiva | OK — nenhum `.delete()` nos repositórios/API |

## Pendências explícitas

- Aplicar migrations **011–014** no Supabase (SQL Editor, em ordem)
- Executar `npm run verify:env` após migrations
- Smokes live: `npm run test:bootstrap:smoke`, `npm run test:correction:smoke`, `npm run test:pipeline:smoke`
- Testes de integração E2E com Supabase real (requer instância configurada)
- Políticas RLS por usuário autenticado (BLG-0103)
- Seed de `Genius Hotels` + alias `Genius` via script ou migration opcional

### Backlog pós-entrega

- `corrections.status` (retração)
- Invalidação explícita de alias
- Purge automático de candidates órfãos
- `GET /inbox-items/:id/derived-artifacts`

# Changelog arquitetural

Registro de mudanças estruturais relevantes (não substitui commits git).

---

## 2026-06-03 — S2: external_action não bloqueia promote

- **Migration incremental** `20260603130000_s2_external_action_no_promote_block.sql` — remove gate global `BLOCKING_CLARIFICATIONS` para `external_action` em `promote_extraction_run`.
- **Comportamento:** memória estruturalmente válida promove; `inbox_items.processing_status = completed`; clarifications `external_action` ficam `record_status = active` + `status = pending`.
- **Execução externa:** continua proibida (sem Action Gateway); bloqueio futuro na camada de ação, não na ingestão.
- **`verify-env` / `test-greenfield-rpcs.sql`:** probe `external_action` espera promote OK (alinhado a KC/task_execution pós-S1).

---

## 2026-06-03 — Audit UI v1: operacionalização mínima

- **Build:** correção TS2367 em `MemoryCompilerV2` (`ambiguous_identity` canônico v1.4).
- **`internal-api-access`:** hook global em production — rotas sensíveis exigem `INTERNAL_PROCESSING_SECRET` via header; públicas: `/health`, `/webhooks/telegram`, shell `/audit` (+ css/js).
- **`npm run verify:runtime`** — garante `public/audit/*` presente antes de deploy.
- **`npm run start:prod`** — entrypoint production (`node dist/server.js`).
- **Audit UI:** segredo só via formulário + `sessionStorage` + header (sem `?secret=`).
- **Deploy:** sem Dockerfile/Railway no repo; instruções no playbook (build + verify:runtime + start:prod).

---

## 2026-06-03 — Audit UI v1 (read-only)

- **`GET /audit`** — página HTML interna (vanilla JS em `public/audit/`).
- **`GET /audit/inbox-items`** e **`GET /audit/inbox-items/:id`** — endpoints somente leitura agregando inbox, entidades MVP, eventos, assertions greenfield, tasks via `task_mutations`, clarifications e detalhes técnicos do run.
- **`AuditService`** — calcula `visual_status` e filtros Todos/Revisar/Falhas após agregar clarifications, warnings, runs e corrections; lista limitada a 100 itens.

---

## 2026-06-03 — S1.1: hardening operacional da simplificação

- **Migration incremental** `20260603120000_s1_simplify_promote_blocking_scope.sql` — promote bloqueado só por `external_action`; histórico `20260602100001` preservado (KC+EA).
- **`npm run db:apply-incremental-migrations`** — runner oficial pós-greenfield; removido `reapply-greenfield-rpcs.ts` (não substitui migrations).
- **`apply-greenfield-schema`** — inclui migration S1 na ordem completa para installs novos.
- **`correction-smoke-test.ts`** — contrato greenfield (`title`, `record_status`); valida lifecycle IIE Marcelo→Bruno e ausência de entidades periféricas canônicas.
- **`MemoryCompilerV2`** — `entity_mentions` com referência superseded por `correction_signal` não entram em `resolvedEntities`.
- **`extraction-sanitizer`** — filtra `review_reason` com “Ambiguidade no tipo…” após resolução de Genius.
- **`e2e-smoke-test.ts`** — clarifications filtradas por `inbox_item_id`.

---

## 2026-06-03 — S1: registry MVP + materialidade de ambiguidade

- **`mvp-registry-policy`:** registry automático restrito a `person`, `company`, `project`, `product`; `isMvpRegistryEligibleReference` para ambiguidade material.
- **`MemoryCompilerV2`:** menções fora do allowlist não entram em `resolvedEntities`; clarificações de identidade/tipo só para referências registry-eligible; candidatos LLM periféricos ignorados com `compilerNotes`.
- **`ClarificationManagerV2`:** `task_execution` e `knowledge_confirmation` periférica (não registry-eligible) → `non_blocking`; conflitos de identidade material só quando registry-eligible.
- **`promote_extraction_run`:** contador de bloqueio global apenas `blocking_scope = external_action` (KC não trava promote).
- **`PersistenceV2`:** defesa — não cria candidate entity/IIE para tipos fora do allowlist.
- **Testes:** `mvp-registry-policy.test.ts`, cenário Marcelo→Bruno (unit), probes `verify-env` e SQL cenário 9 atualizados.
- **Sem alteração nesta rodada:** prompt/schema extractor-v1.4, segunda LLM, Context Builder, bootstrap completo, HTTP corrections, desligamento v1.3, pipeline smoke 15/15.

---

## 2026-06-03 — Hardening pós-smoke greenfield (promote + missing_task_target)

- **`promote_extraction_run`:** promote bloqueado apenas por clarifications `blocking` com `blocking_scope` em `knowledge_confirmation` ou `external_action`; `task_execution` (ex. `missing_task_target`) **não** impede promote — clarification permanece `pending`.
- **`MemoryCompilerV2`:** tarefa `create` com fornecedor genérico (`target_reference` null ou `fornecedor`/`o fornecedor`) gera deterministicamente `missing_task_target` / `task_execution` / pergunta canônica `"Qual fornecedor deve ser cobrado?"`.
- **`apply-greenfield-schema.ts`:** apply completo idempotente na ordem baseline → RPCs → seeds; logs `✓ baseline applied`, `✓ RPCs applied`, `✓ seeds applied` — **sem reaplicação manual** da migration RPC após apply.
- **`verify-env`:** probe transacional de semântica `promote_extraction_run` (task_execution permite; knowledge_confirmation e external_action bloqueiam) + validação estática do filtro no repo.
- **`test-greenfield-rpcs.sql`:** cenários 8–10 para blocking_scope.
- **Testes:** `memory-compiler-v2.test.ts`, `greenfield-rpcs-static.test.ts`.
- **Sem alteração:** extractor-v1.4, prompt, schema OpenAI, TemporalNormalizer, enforce, bootstrap pessoal.

---

## 2026-06-02 — Bloco 6F: hardening mínimo pré-apply greenfield

- **Validações de flags em `loadEnv()`:** combinações perigosas greenfield/persistência bloqueadas com erros explícitos.
- **RPCs:** `apply_task_mutations_for_run` exige `task_id` e existência em `tasks` para operações não-`create`; erros `TASK_MUTATION_TARGET_REQUIRED` / `TASK_MUTATION_TARGET_NOT_FOUND`.
- **`fail_extraction_run`:** rejeita `entities` e `entity_aliases` com `registry_status=candidate` criados pelo run.
- **`apply-greenfield-schema.ts`:** banner destrutivo (URL, host, database) + `GREENFIELD_SCHEMA_APPLY_CONFIRM`.
- **Smoke SQL:** `scripts/test-greenfield-rpcs.sql` expandido (create, update, complete, falhas, rollback, fail registry).
- **Dívidas registradas** (prioritárias antes de enforce) — ver backlog v1.2 e `schema-current.md`.
- **Sem alteração:** extractor, prompt, schema OpenAI, compiler, CM, TemporalNormalizer, enforce, transação app-side em lote.

---

## 2026-06-03 — Bloco 5C: TemporalNormalizer no Memory Compiler v2

- **`CompiledTaskV2.dueAtTemporal`** + `MemoryCompilerV2Input.temporalAnchor` / `TemporalAnchor`.
- Compiler delega a `TemporalNormalizerService`; anchor ausente com `dueAt` → `missing_temporal_anchor` (failed, instant null).
- Runners: `run-v14-context-pipeline` (default anchor calibração), live calibration, shadow (só com `inbox.received_at`).
- Shadow log seguro: campos `temporal_*` agregados (sem literal/instant completo).
- Expectativas opcionais `due_at_temporal` em calibração fixed/context.
- **Sem alteração:** extractor, prompt, schema, CM, semantic gate, runtime v1.3, Supabase.
- **Próximo:** Supabase homolog greenfield + persistência `CompiledMemoryV2`.

---

## 2026-06-03 — Bloco 5B: calibração offline TemporalNormalizer

- **Calibração determinística versionada** — `npm run calibrate:temporal:normalizer` (fixtures) e `--compare-baseline` (baseline congelada).
- **Fonte canônica de casos:** `data/calibration/temporal-normalizer/cases.json` (54 casos; usada por testes e runner).
- **Baseline:** `data/calibration/temporal-normalizer/v1.0.0-baseline.json` (snapshots semânticos @ 1.0.0).
- **Relatórios:** `artifacts/calibration/temporal-normalizer-v1-report.json`, `temporal-normalizer-v1-summary.md`.
- **Padrão `relative_with_time`:** `amanhã às 10h`, `amanha as 10h`, `amanhã 10h`, `amanhã às 10:30`; `amanhã às 25h` → `impossible_time`.
- Módulo: `src/calibration/temporal-normalizer/`.
- **Sem alteração:** Memory Compiler v2, extractor, CM, runtime produtivo, Supabase.
- **Próximo:** Bloco 5C — wire `dueAtTemporal` no Memory Compiler v2.

---

## 2026-06-03 — Bloco 5A: TemporalNormalizer puro

- **TemporalNormalizer v1.0.0** — tipos, service, utils, testes unitários iniciais.
- Regras: `docs/regras_canonicas_normalizacao_temporal_v1.md`.
- **Legado:** `src/utils/temporal.ts` congelado para v1.3.

---

- **Semantic gate extractor-v1.4 = approved**
  - `run_id`: `v14-live-2026-06-03T00-20-08-750Z-88484fa2`
  - 13 categorias × 5 repetições = 65 runs live; case pass 64/65; todos os thresholds semânticos atendidos; `pass: true`, exit 0
  - Capturas isoladas: `artifacts/calibration/extractor-v1.4-live-runs/v14-live-2026-06-03T00-20-08-750Z-88484fa2/`
  - Relatórios: `extractor-v1.4-semantic-gate-report.json`, `extractor-v1.4-semantic-gate-summary.md`
- **Limitação conhecida:** `static_preferences` — 1/5 run classificou preferência como `fact` vs `opinion`; não bloqueou `finalDecision`; registrar; não corrigir no gate.
- **Contrato `status_update` consolidado (pré-gate):** `predicate` = dimensão; `value_text` obrigatório; compiler `status_update_missing_value`; prompt mínimo.
- **Próximo bloco planejado:** normalização determinística de datas relativas (Bloco 5) — plano em `docs/bloco-5-normalizacao-datas-relativas-plano.md`; **não implementado**.
- Sem alteração em runtime produtivo, Supabase, migrations, persistência, enforce ou bootstrap pessoal nesta entrega doc-only.

---

## 2026-06-02 — Quality gate semântico amplo (Bloco 4F)

- **Causa do falso exit code:** `finalizeV14Metrics` usava `ratio(den=0) → 1`; `preference_to_event_rate` era avaliado mesmo sem runs `static_preferences`, falhando threshold `= 0`.
- **Correção:** `metricRatio` / `ratioOrNull` — denominador zero → `not_applicable` (`value: null`); gate legado e semantic gate só reprovam métricas aplicáveis.
- **Segregação por run:** capturas em `artifacts/calibration/extractor-v1.4-live-runs/<run_id>/` com `manifest.json` (`run_id`, versões, categorias, repetições).
- **Relatórios:** `extractor-v1.4-semantic-gate-report.json`, `extractor-v1.4-semantic-gate-summary.md` (métricas agregadas + por categoria, materialidade, residuais, recomendação).
- **Calibração contextual (4E):** aprovada (métricas 1.00 / 0 false blocking).
- **Quality gate amplo:** em validação via live 13×5; próximo passo condicionado ao relatório.
- Sem normalização de datas, Supabase greenfield, migrations, `CompiledMemoryV2` persistido, enforce ou segunda LLM.

---

## 2026-06-02 — Taxonomia canônica de clarificações (Bloco 4E)

- Enum `ClarificationIssueType` / `CLARIFICATION_ISSUE_TYPES` em `extractor-v1.4.types.ts` e JSON Schema strict.
- Prompt extractor-v1.4: instrução enxuta para enum canônico, `missing_assignee_or_due_date`, fallback `other`.
- Schema rejeita sinônimos livres (ex.: `missing_assignment_and_deadline`).
- `ClarificationManagerV2`: `other` → blocking por padrão; materialidade de enrichment preservada.
- Fixtures v1.4 atualizadas (`ambiguous_identity` canônico).
- Docs: `docs/regras_canonicas_ingestao_contexto_clarificacoes_v1.md`, seção 3.8 em `extractor-v1.4-spec.md`.
- Sem alteração em runtime produtivo, Supabase, migrations ou compiler determinístico.

---

## 2026-06-02 — Memory Compiler v2 Bloco 2 (isolado)

- `MemoryCompilerV2Service`, `ClarificationManagerV2Service`, `ReferenceResolverService`
- `utils/source-blocks.ts`, `EffectiveInputBuilder.buildEffectiveInputWithSourceBlocks`
- `npm run test:extractor:v1.4:fixed` — 13 casos sintéticos sem OpenAI/DB
- Pipeline produtivo permanece v1.3

## 2026-06-02 — Extractor v1.4 Bloco 1 (contrato produtivo isolado)

- `src/openai/extractor-v1.4.{types,schema,prompt,service}.ts` + `source-block-reference.ts`
- Dataset `data/calibration/extractor-v1.4/` (13 casos sintéticos)
- `npm run extractor:v1.4:isolated` — smoke sem pipeline
- Pipeline produtivo permanece v1.3

## 2026-06-02 — Spec extractor-v1.4 greenfield (doc-only)

- `docs/extractor-v1.4-spec.md` — contrato canônico v1.4 (mentions, aliases, events, assertions, tasks, review_hints).
- `scripts/audit-live-variability-detail.ts` — auditoria 80 capturas → `compiler-v1-live-audit-detail.json`.
- `artifacts/calibration/extractor-v1.4-spec.generated.md` — rascunho automático (não canônico).
- `docs/drafts/extractor-v1.4.types.ts` — tipos draft.

## 2026-06-02 — Reset homologação + calibração live capture

- `reset:test-data` corrige FK `entities.created_by_extraction_run_id` (nullify antes de apagar runs).
- Verificação pós-reset automatizada; bloqueio produção via URL/NODE_ENV.
- Runner: `--capture-live-fixtures`, `--categories`, `--repetitions`; capturas em `artifacts/calibration/live-captures/`.
- `npm run promote:live-captures` para promover revisadas a `data/calibration/compiler-v1/captured/`.
- Relatório `compiler-v1-live-variability-report.json`.

## 2026-06-02 — Memory Compiler v1 (shadow)

- `MemoryCompilerService` e `ClarificationManagerService` em shadow (`MEMORY_COMPILER_MODE`).
- Dataset de calibração `data/calibration/compiler-v1/` e runner `npm run test:compiler:calibration`.
- Baseline documentado em `docs/compiler-baseline.md`.
- Sem alteração em extractor prompt/schema, persistência produtiva, migrations 011–014 ou RPCs.

---

## 2026-06-01 — Pipeline de memória versionado (011–014)

### Schema

- `inbox_extraction_runs` reconciliado com colunas de lineage e versões.
- `inbox_item_entities` — proveniência universal inbox↔entidade.
- `entity_alias_evidences` — evidência para promoção de alias.
- `entities` / `entity_aliases`: `registry_status` (candidate | active | superseded).
- `inbox_items`: `active_extraction_run_id`, `latest_extraction_run_id`.
- Artefatos derivados: `record_status` (candidate | active | superseded).

### RPCs

- `start_extraction_run`, `promote_extraction_run`, `fail_extraction_run`.
- Single-flight, stale guard, grants service_role.

### Código

- `ExtractionPipelineService`, `EffectiveInputBuilder`, `ReprocessService`.
- Registry candidate reuse + promoção por evidência.
- REST: `has_active_memory`; MCP: `list_inbox_extraction_runs`, `list_inbox_item_entities`.
- Backfill 014 para inbox `completed` legados.

### Testes e smokes

- Testes unitários: pipeline, effective input, registry reuse, memory search IIE.
- Smoke bootstrap atualizado: IIE active, extraction run pointers.
- Smoke pipeline (15 cenários): `npm run test:pipeline:smoke`.

### Pendente homologação real

- Aplicar migrations 011–014 no Supabase.
- `npm run verify:env` → reset → bootstrap → smokes.

---

## 2026-05-31 — Correções pós-auditoria bootstrap 01

### Aliases

- Removida coluna redundante `entities.aliases` (migration **010**).
- REST e MCP passam a hidratar aliases exclusivamente de `entity_aliases`.

### Bootstrap linking

- Linking amplo no evento principal determinado por `source_channel = bootstrap`.
- Aceita `profile_created`, `document_snapshot` e outros tipos semânticos como evento principal.
- Localidades incluídas nos vínculos do evento principal.

### Assertions

- Confirmado: sem limite artificial de 15; omissões são seletivas do modelo.
- Adicionado mecanismo de revisão `bootstrap_assertion_completeness_review` e teto `BOOTSTRAP_MAX_ASSERTIONS = 100`.

### Testes

- Testes unitários: bootstrap primary event, assertion review, memory search hydration, persistence bootstrap vs cotidiano.
- Smoke bootstrap atualizado (16 entities, 11 aliases, IIE active + extraction run pointers).

### Pendente homologação real

- Aplicar migration 010 no Supabase.
- Reset, reimportar `01-identidade-e-pessoas.md`, rodar `npm run test:bootstrap:smoke`.

---

## 2026-06-07 — Phase 5: Contextual Reasoner (scaffold + integração)

Bug reports Wellerson 2026-06-07 (webchat):
- **J1** — Prazo perguntado de novo em sub-task (msg 231 "Eu mesmo vou corrigir..." → bot perguntou "qual o prazo?" mas msg 228 já tinha "pretendo acabar hoje mesmo").
- **J2** (corrigido Wellerson) — Evento "Estar no Rio pela Websummit" não era hallucination, user tinha sim mencionado.
- **J3** — Clarif pile-up (msg 225 pediu 2 clarifs, msg 228 respondeu as 2, bot criou 3ª clarif em vez de resolver pendentes).

**Solução:** Contextual Reasoner — LLM (gpt-4o-mini) que recebe mensagem atual + clarifs pendentes + thread context + tasks ativas, e decide:
- `pure_reply` (resolve clarif, sem extração)
- `new_capture` (extrai normalmente)
- `mixed` (resolve clarif + extrai)
- `update_existing` (atualiza task)
- `cancel_pending` (cancela task)
- `unrelated` (small talk, ignora)

**Arquivos novos:**
- `docs/plans/PHASE_5_REASONER.md` — design doc completo (TL;DR, arquitetura, JSON schema, few-shots, trade-offs, métricas, rollout)
- `src/services/contextual-reasoner.types.ts` — ReasonInput/Output (Zod)
- `src/services/contextual-reasoner.prompt.ts` — system prompt + 5 few-shots canônicos
- `src/services/contextual-reasoner.service.ts` — LLM call + parse + sanity checks
- `src/services/reasoner-context.builder.ts` — junta inbox/clarifs/thread num ReasonInput
- `tests/contextual-reasoner.service.test.ts` — 14 unit tests (parse, fallback, sanity, error handling)
- `tests/contextual-reasoner.eval.test.ts` — 10 cenários canônicos + sanity fallback (roda com `RUN_OPENAI_INTEGRATION_TESTS=true`)
- `tests/helpers/reasoner-fixtures.ts` — fixtures

**Modificados:**
- `src/services/assistant-turn.service.ts` — novo stage ALS `reason` antes de `extraction`; constructor aceita `reasoner: ContextualReasonerService | null`
- `src/app.ts` — wire condicional `env.OPENAI_API_KEY && env.REASONER_ENABLED ? createContextualReasonerService() : null`
- `src/config/env.ts` — `REASONER_ENABLED` (default false) + `REASONER_MODEL` (default gpt-4o-mini)
- `src/utils/structured-logger.ts` — novo LogStage `reason`
- `.env.example` — documentação dos 2 flags novos

**Status:** 5.1 entregue (scaffold + integração desabilitada por default). 5.2 (eval expandida) e 5.3 (rollout) são próximas sprints. **Não ligar em produção** sem rodar eval suite + 1 semana de shadow mode.

**Testes:** 495/507 passam (11 skipped = eval live, 1 pré-existente idx_assertions). 14 tests novos do reasoner, todos verdes.

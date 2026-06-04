# Playbook — uso real assistido (homologação MVP)

Diretriz vigente:

```text
Capture primeiro.
Canonize progressivamente.
Bloqueie somente quando houver risco real.
```

Pré-requisitos: `GREENFIELD_SCHEMA=true`, `EXTRACTOR_V14_SHADOW_ENABLED=true`, `PERSIST_COMPILED_MEMORY_V2=true`, API (`npm run dev`), `verify:env` verde.

---

## Proibição operacional — ações externas (S3.1)

**Nesta fase, ações externas não podem ser executadas** — nem pelo operador assistido nem por automação.

Inclui, sem exaustão:

```text
- enviar e-mail
- enviar mensagem (WhatsApp, Slack, Telegram, etc.)
- criar evento de calendário
- alterar evento de calendário
- executar qualquer operação fora da memória (APIs de terceiros, CRM, ERP, etc.)
```

O sistema **captura e canoniza** intenções; **não executa** ações externas.

A detecção end-to-end de `external_action` pelo extrator ainda é inconsistente (ver bateria S3.1). O bloqueio RPC existe (`verify:env`), mas frases imperativas podem ser classificadas como tarefa interna. **Trate toda frase imperativa de ação externa como proibida para execução**, independentemente do promote.

```bash
ALLOW_EXTERNAL_ACTION_CALIBRATION=true npm run test:external-action:classification
# → artifacts/calibration/external-action-s31-report.json
```

---

## Limites da fase atual

1. **Entradas pequenas** — preferir textos curtos e auditáveis (como `data/bootstrap/s3-controlled-fixtures.json`); não importar panorama pessoal completo.
2. **Auditar promote** — após cada entrada, conferir `/inbox-items/:id/entities` e `/memory/search`.
3. **Não executar ações externas** — ver seção acima; capture-only.
4. **Termos genéricos** — `cliente`, `fornecedor`, `person`, `company`, etc. não viram entidade canônica (compiler S3.1).
5. **Registrar erros reais** — antes de criar nova regra determinística, documentar o caso e avaliar se clarification non-blocking basta.
6. **Lacunas de API conhecidas** — ver backlog S3-P6/S3-P7; usar `source_excerpt` ou Supabase quando REST não rastreia lineage.

---

## Auditoria visual (`/audit`) — v1 somente leitura

Ferramenta interna para comparar `raw_content` com artefatos promovidos.

### Rodar localmente (development)

```bash
npm install
cp .env.example .env   # preencher Supabase/OpenAI/greenfield
npm run dev
npm run verify:runtime
```

Abrir `http://127.0.0.1:3000/audit` — shell HTML + dados via API, sem segredo em `NODE_ENV=development`.

### Rodar em production local

```bash
npm run build
npm run verify:runtime
INTERNAL_PROCESSING_SECRET=segredo-local-homolog \
  NODE_ENV=production \
  PORT=3001 \
  npm run start:prod
```

Validar:

| Request | Sem secret | Com header `x-internal-processing-secret` |
|---------|------------|---------------------------------------------|
| `GET /audit` | 200 (shell vazio) | 200 |
| `GET /audit/inbox-items` | 503 | 200 |
| `GET /entities` | 503 | 200 |
| `GET /health` | 200 | 200 |

Na UI: informe o segredo no formulário inicial (fica em `sessionStorage` da aba); **não** use query string. Chamadas usam header `x-internal-processing-secret`.

### Deploy em homologação (Railway ou similar)

Não há `Dockerfile`/`railway.toml` no repositório. Deploy mínimo:

```text
Build command:  npm ci && npm run build && npm run verify:runtime
Start command:  npm run start:prod
Root directory: repositório completo (precisa de public/audit/)
```

Variáveis obrigatórias em homologação online:

```text
NODE_ENV=production
PORT=3000
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
OPENAI_API_KEY
GREENFIELD_SCHEMA=true
EXTRACTOR_V14_SHADOW_ENABLED=true
PERSIST_COMPILED_MEMORY_V2=true
INTERNAL_PROCESSING_SECRET=<segredo-forte>
TELEGRAM_* (se captura via Telegram)
```

URL esperada: `https://<app>.up.railway.app/audit` (shell) — dados só após segredo no formulário.

Smoke pós-deploy:

```bash
curl -s -o /dev/null -w "%{http_code}" https://<app>/health
curl -s -o /dev/null -w "%{http_code}" https://<app>/audit
curl -s -o /dev/null -w "%{http_code}" https://<app>/audit/inbox-items   # → 503
curl -s -H "x-internal-processing-secret: $SECRET" https://<app>/audit/inbox-items | head
```

### Rotas públicas em production (sem INTERNAL_PROCESSING_SECRET)

| Rota | Motivo | Proteção | Risco residual |
|------|--------|----------|----------------|
| `GET /health` | healthcheck do deploy | nenhuma | expõe apenas `{ status: ok }` |
| `POST /webhooks/telegram` | captura conversacional | `TELEGRAM_WEBHOOK_SECRET` | spam/abuse se secret vazar |
| `GET /audit` + assets estáticos | shell HTML/JS/CSS sem dados | nenhuma | expõe layout interno, não memória |

Demais rotas REST → `503` sem secret configurado, `401` sem header válido.

**Como revisar uma entrada**

1. Abra `/audit` — lista dos últimos **100** `inbox_items`.
2. Primeiro item selecionado automaticamente.
3. Filtros **Todos**, **Revisar**, **Falhas** + busca textual.
4. Compare painel direito com **Ver detalhes técnicos**.

**Status visuais:** Processado · Revisar · Falhou · Corrigido (não alteram o banco).

**Limitações v1:** somente leitura; sem POST de clarifications/corrections/reprocess; lista limitada a 100 itens; shell `/audit` público em production (dados protegidos).

---

## 1. Enviar uma entrada manual

```bash
curl -s -X POST http://127.0.0.1:3000/inbox-items \
  -H 'Content-Type: application/json' \
  -d '{
    "raw_content": "Texto da entrada.",
    "source_channel": "manual-assistido",
    "source_mode": "conversational",
    "received_at": "2026-05-31T10:00:00-03:00",
    "timezone": "America/Sao_Paulo"
  }'
```

Guarde `inbox_item_id` e `processing_status`. Entrada bem-sucedida → `completed`.

---

## 2. Conferir o que foi promovido

```bash
# Metadados do inbox (raw_content preservado)
curl -s http://127.0.0.1:3000/inbox-items/<inbox_item_id>

# Runs e promote
curl -s http://127.0.0.1:3000/inbox-items/<inbox_item_id>/runs

# Entidades active vinculadas
curl -s http://127.0.0.1:3000/inbox-items/<inbox_item_id>/entities

# Busca transversal
curl -s 'http://127.0.0.1:3000/memory/search?q=VELT'
curl -s 'http://127.0.0.1:3000/entities?limit=50'
```

Registry automático MVP: apenas `person`, `company`, `project`, `product` **com nome próprio**. Termos genéricos (`cliente`, `fornecedor`, tipos literais) e periféricos (`reunião`, `integração`) permanecem no texto.

---

## 3. Identificar clarification pendente

```bash
curl -s 'http://127.0.0.1:3000/clarifications?status=pending'
```

Filtrar por `inbox_item_id`. Tipos comuns:

| issue_type | blocking_scope | Efeito no promote |
|------------|----------------|-------------------|
| `missing_task_target` | `task_execution` | promote OK; execução futura bloqueada |
| `missing_external_action_target` | `external_action` | **promote bloqueado** (RPC) |
| KC periférica | `knowledge_confirmation` | promote OK (S1) |

---

## 4. Corrigir uma informação

```bash
curl -s -X POST http://127.0.0.1:3000/inbox-items/<inbox_item_id>/corrections \
  -H 'Content-Type: application/json' \
  -d '{"correction_text": "Na verdade, Bruno Brant participou da call."}'
```

`raw_content` original **não** muda. Novo run `correction` → promote. Participante anterior → `superseded`; vigente → `active`.

---

## 5. Reprocessar uma entrada

```bash
curl -s -X POST http://127.0.0.1:3000/inbox-items/<inbox_item_id>/reprocess
```

Útil após correções acumuladas ou mudança de política. Run anterior permanece no histórico; `active_extraction_run_id` aponta para o mais recente promovido.

---

## 6. Verificar falha

| Sintoma | Onde olhar |
|---------|------------|
| `processing_status: failed` | `GET /inbox-items/:id` → `processing_error` |
| HTTP 500 no POST | logs do servidor; mensagem `BLOCKING_CLARIFICATIONS` = ação externa insegura |
| Run `validated` sem promote | clarifications `external_action` + `materiality=blocking` |
| Entidade inesperada | `GET /inbox-items/:id/entities` — genéricos não deveriam aparecer |

```bash
npm run verify:env
```

---

## 7. Preservar evidências para análise

```bash
# Bootstrap controlado S3 (10 entradas + relatório)
ALLOW_CONTROLLED_BOOTSTRAP=true npm run bootstrap:controlled
# → artifacts/bootstrap/s3-controlled-bootstrap-report.json

# Bateria external_action S3.1
ALLOW_EXTERNAL_ACTION_CALIBRATION=true npm run test:external-action:classification
# → artifacts/calibration/external-action-s31-report.json

# Smokes de referência
npm run test:correction:smoke
npm run test:e2e:smoke
ALLOW_PIPELINE_SMOKE=true npm run test:pipeline:smoke
```

Exportar do Supabase: `inbox_items`, `inbox_extraction_runs`, `inbox_item_entities`, `events`, `tasks`, `task_mutations`, `clarification_requests` filtrados por `inbox_item_id`.

---

## 8. Quando **não** adicionar nova regra determinística

Antes de codificar um `if` novo, responder:

1. Protege integridade ou segurança real?
2. É curta, geral e verificável?
3. Apareceu em casos reais recorrentes no bootstrap ou smokes?
4. Pode ser só `needs_review` / clarification non-blocking?
5. Reduz complexidade total?

Se alguma resposta for **não** → não adicionar regra; registrar no backlog.

---

## Bootstrap controlado (S3 / S3.1)

Fixtures: `data/bootstrap/s3-controlled-fixtures.json`

```bash
ALLOW_TEST_DATA_RESET=true npm run reset:test-data   # estado limpo + seed Genius
npm run verify:env
npm run dev
ALLOW_CONTROLLED_BOOTSTRAP=true npm run bootstrap:controlled
```

S3.1 valida adicionalmente: termos genéricos não promovidos; entidades nucleus presentes; correção Marcelo→Bruno; `missing_task_target` em fornecedor genérico.

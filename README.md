# Segundo Cérebro Tick

MVP de API do **Segundo Cérebro Pessoal com Agentes de IA**: captura preservando o original, extração estruturada via OpenAI, resolução de entidades, clarificações, persistência em Supabase e consulta via REST e MCP (somente leitura).

## Pré-requisitos

- Node.js 20+
- Projeto Supabase com Postgres
- Chave OpenAI com acesso à Responses API

## Instalação

```bash
git clone <repo>
cd segundo-cerebro-tick
npm install
cp .env.example .env
# Preencha SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
```

## Variáveis de ambiente

Ver `.env.example`:

| Variável | Descrição |
|----------|-----------|
| `PORT` | Porta HTTP (padrão 3000) |
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave service role (apenas servidor) |
| `OPENAI_API_KEY` | Chave OpenAI |
| `OPENAI_MODEL` | Modelo (padrão: `gpt-5-mini`) |
| `RUN_OPENAI_INTEGRATION_TESTS` | `true` para testes com API real |
| `TELEGRAM_BOT_TOKEN` | Token do BotFather (interface Telegram) |
| `TELEGRAM_ALLOWED_USER_ID` | ID numérico do usuário autorizado a capturar |
| `TELEGRAM_WEBHOOK_SECRET` | `secret_token` do webhook (header `X-Telegram-Bot-Api-Secret-Token`) |
| `TELEGRAM_WEBHOOK_URL` | URL pública registrada no Telegram (ex.: webhook do n8n) |
| `TELEGRAM_DEFAULT_TIMEZONE` | Fuso nas capturas via Telegram (padrão: `America/Sao_Paulo`) |

### Telegram (n8n → API)

1. Preencha as variáveis `TELEGRAM_*` no `.env`.
2. `npm run telegram:set-webhook` — registra no Telegram a URL do n8n com o secret.
3. No n8n, após o trigger Telegram, faça HTTP POST para `http://<sua-api>/webhooks/telegram` com header `X-Telegram-Bot-Api-Secret-Token: <TELEGRAM_WEBHOOK_SECRET>` e corpo igual ao update do Telegram (ou `{ "text": "...", "user_id": 5991664193 }`).
4. A API processa como `source_channel=telegram` e responde no chat com um resumo da captura.

## Migrations

Execute no SQL Editor do Supabase (ordem):

1. `supabase/migrations/001_core.sql` — **obrigatória**
2. `supabase/migrations/002_clarifications_and_resolution.sql` — **obrigatória**
3. `supabase/migrations/003_seed_genius_example.sql` — **opcional** (cenário controlado Genius → Genius Hotels)
4. `supabase/migrations/004_align_existing_schema.sql` — **obrigatória em bancos criados antes da versão atual** (alinha colunas/tabelas ausentes sem apagar dados; idempotente)

Se o banco já existia parcialmente (ex.: erro `source_channel` ausente em `inbox_items`), rode **004** após 001 e 002. Em projeto novo, 001 + 002 bastam; 004 é segura de executar mesmo assim.

### Alinhamento de schemas legados (005–007)

Execute após **004** quando o Supabase foi criado com constraints/colunas antigas:

| # | Arquivo | Quando |
|---|---------|--------|
| 5 | `005_align_legacy_insert_defaults.sql` | defaults e colunas `NOT NULL` sem default no legado |
| 6 | `006_allow_events_occurred_at_null.sql` | `events.occurred_at` nullable (evento sem data no texto) |
| 7 | `007_align_inbox_processing_status.sql` | CHECK `processing_status` → contrato MVP (`completed`; legado costuma usar `processed`) |

Ordem recomendada em banco pré-existente: **004 → 005 → 006 → 007 → 008 → 009**.

| 8 | `008_entity_lifecycle_and_inbox_processed_at.sql` | `processed_at`, `event_entities.relation_type`, `ambiguous_alias_conflict` |
| 9 | `009_align_event_entities_relation_type.sql` | `event_entities.relation_type NOT NULL DEFAULT 'mentioned'` |

A **007** falha com mensagem explícita se existirem linhas com `processed`, `needs_review`, `ignored` etc. — corrija manualmente antes de reaplicar (sem conversão automática).

Antes do smoke E2E: `npm run verify:env` (inclui probe da constraint de `processing_status`).

## Homologação E2E real

Migrations **001** e **002** são obrigatórias. A **003** é opcional e alimenta o cenário controlado Genius → Genius Hotels.

Verifique credenciais e schema antes do smoke test:

```bash
npm run verify:env
```

Com Supabase, OpenAI e migrations aplicadas:

```bash
npm run dev
# em outro terminal — sequência completa de homologação:
ALLOW_TEST_DATA_RESET=true npm run reset:test-data
npm run test:e2e:smoke
npm run test:mcp:smoke
npm run test:clarification:smoke
npm run test:correction:smoke
```

| Script | O que valida |
|--------|----------------|
| `test:e2e:smoke` | API REST — cenário Genius, sanitização pós-resolver |
| `test:mcp:smoke` | MCP stdio read-only (6 tools) sobre dados do E2E |
| `test:clarification:smoke` | `POST /clarifications/:id/resolve` |
| `test:correction:smoke` | Correção com histórico (Marcelo → Bruno), inbox isolado |

O E2E valida `GET /health`, processa o cenário Genius completo, consulta memória/tarefas/clarificações e falha com exit code 1 se algum critério mínimo não for atendido.

### MCP Inspector (manual, opcional)

```bash
npx -y @modelcontextprotocol/inspector@latest npx tsx src/mcp/server.ts
```

Defina `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no ambiente do Inspector.

### Reset de dados de homologação

Antes de repetir o smoke E2E, você pode limpar o banco de homologação e recriar o seed Genius Hotels:

```bash
ALLOW_TEST_DATA_RESET=true npm run reset:test-data
```

- **Somente homologação** — nunca use em produção.
- **Remove todos os registros** das tabelas de fluxo (`inbox_items`, `events`, `tasks`, etc.); não há limpeza seletiva por `source_channel`.
- **Ao final** recria de forma idempotente a entidade **Genius Hotels** (`id` fixo) e o alias **Genius**.
- Exige `ALLOW_TEST_DATA_RESET=true` para executar; não roda em `npm test` nem na API em runtime.

O smoke E2E usa `source_channel: e2e-smoke` para facilitar inspeção manual após testes.

## Execução local

```bash
npm run dev
```

API em `http://localhost:3000`.

## Bootstrap do panorama inicial

Importação manual do panorama curado via pipeline normal (`POST /inbox-items`). Não insere dados diretamente no banco.

```bash
cp data/bootstrap/memoria-inicial.example.md data/bootstrap/memoria-inicial.md
# Editar manualmente data/bootstrap/memoria-inicial.md
```

Validar sem persistir (requer API **não** necessária no dry-run):

```bash
ALLOW_BOOTSTRAP_IMPORT=true npm run import:bootstrap -- data/bootstrap/memoria-inicial.md --dry-run
```

Importar (requer `npm run dev` ativo):

```bash
ALLOW_BOOTSTRAP_IMPORT=true npm run import:bootstrap -- data/bootstrap/memoria-inicial.md
```

Notas:

- O panorama inicial deve ser **curado**; não importe histórico completo de e-mails ou mensagens nesta etapa.
- O conteúdo passa pelo pipeline normal (extractor → Memory Resolver → persistência); o `raw_content` original é preservado integralmente.
- Clarificações podem ser geradas após a importação.
- Exige `ALLOW_BOOTSTRAP_IMPORT=true` como proteção contra importação acidental.
- Limite padrão de 50.000 caracteres (`BOOTSTRAP_MAX_CHARS` sobrescrevível no `.env`).
- O arquivo pessoal `data/bootstrap/memoria-inicial.md` **não deve ser commitado** (está no `.gitignore`); use `memoria-inicial.example.md` como template versionado.

Requer migrations **008**, **009** e **010** aplicadas no Supabase, reset e reimportação após atualizar o código:

```bash
ALLOW_TEST_DATA_RESET=true npm run reset:test-data
ALLOW_BOOTSTRAP_IMPORT=true npm run import:bootstrap -- data/bootstrap/01-identidade-e-pessoas.md
npm run test:bootstrap:smoke
```

O smoke valida 16 entidades, 11 aliases, evento principal (`profile_created` ou `document_snapshot`) com 16 `event_entities`, hidratação REST/MCP de aliases, e ausência de aliases como entidades separadas.

### Exemplo: capturar nota

```bash
curl -X POST http://localhost:3000/inbox-items \
  -H "Content-Type: application/json" \
  -d '{
    "raw_content": "Conversei com o Bruno sobre a integração da Genius. Preciso cobrar o fornecedor amanhã.",
    "source_channel": "manual",
    "source_mode": "conversational",
    "received_at": "2026-05-31T10:00:00-03:00",
    "timezone": "America/Sao_Paulo"
  }'
```

## Testes

```bash
npm test
npm run lint
```

Testes usam mocks determinísticos. Integração OpenAI real:

```bash
RUN_OPENAI_INTEGRATION_TESTS=true npm test
```

## MCP Inspector

1. Instale o [MCP Inspector](https://github.com/modelcontextprotocol/inspector).
2. Configure o servidor:

```json
{
  "mcpServers": {
    "segundo-cerebro": {
      "command": "npx",
      "args": ["tsx", "src/mcp/server.ts"],
      "cwd": "/caminho/para/segundo-cerebro-tick",
      "env": {
        "SUPABASE_URL": "...",
        "SUPABASE_SERVICE_ROLE_KEY": "...",
        "OPENAI_API_KEY": "..."
      }
    }
  }
}
```

3. Inicie o Inspector e conecte via stdio. Tools disponíveis: ver `docs/mcp-tools.md`.

## Deploy no Railway

1. Crie serviço Node a partir deste repositório.
2. Comando de start: `npm run build && npm start` (ou `npx tsx src/server.ts` sem build).
3. Defina as variáveis de ambiente do `.env.example`.
4. Rode as migrations no Supabase ligado ao projeto.

## Limitações conhecidas (MVP)

- Sem busca vetorial / embeddings
- Sem WhatsApp, e-mail ou calendário reais
- MCP somente leitura
- Sem exclusão definitiva de registros
- Resolução de entidades por SQL relacional simples
- `OPENAI_MODEL` padrão `gpt-5-mini` (configurável por variável de ambiente)

## Documentação

- `docs/api-contracts.md` — contratos REST
- `docs/mcp-tools.md` — tools MCP
- `docs/implementation-notes.md` — decisões de implementação
- `docs/segundo_cerebro_arquitetura_v1.md` — arquitetura (cópia de referência)

## Próximos passos

- Calibração extractor em produção (bateria BLG-0206)
- RLS com políticas por usuário autenticado
- pgvector e busca híbrida
- Interface de captura e revisão de clarificações

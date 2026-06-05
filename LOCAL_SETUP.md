# LOCAL_SETUP — segundo-cerebro-tick

Guia pra rodar o app na sua máquina local (Windows / macOS / Linux).

A VM onde esse projeto foi desenvolvido **já tem** tudo escrito — esse doc
explica como replicar o ambiente localmente.

---

## 0. Pré-requisitos

- **Node.js >= 20** (recomendo `nvm` pra gerenciar versões)
- **Git**
- **psql** (cliente Postgres) — opcional, só pra rodar migrations manualmente
- Conta no **Supabase** com o mesmo projeto (ou crie um novo e rode o schema do zero)
- Conta na **OpenAI** com chave de API
- (Opcional) Bot do **Telegram** se você usar a interface Telegram

---

## 1. Baixar o código

Você está lendo este arquivo porque baixou o bundle (ou clonou o repo).
O bundle contém todo o código + git history, mas **sem** `node_modules`,
`.env`, `dist/` ou `data/bootstrap/memoria-inicial.md` (tudo isso é local).

```bash
# Se você recebeu o bundle .tar.gz:
tar -xzf segundo-cerebro-tick.tar.gz
cd segundo-cerebro-tick

# OU, se preferir clonar do GitHub:
git clone https://github.com/wellersonaaj/segundo-cerebro-tick.git
cd segundo-cerebro-tick
```

---

## 2. Instalar dependências

```bash
npm install
```

Vai baixar ~200 MB de `node_modules`. Demora um pouco na primeira vez.

---

## 3. Configurar variáveis de ambiente

O `.env` **não é versionado** (e nem deve ser). Copie o template e preencha:

```bash
cp .env.example .env
```

Edite `.env` e preencha **no mínimo** estas 5 variáveis (sem elas o app não sobe):

| Variável                     | Onde conseguir                                        |
| ---------------------------- | ----------------------------------------------------- |
| `SUPABASE_URL`               | Supabase → Project Settings → API → Project URL       |
| `SUPABASE_SERVICE_ROLE_KEY`  | Supabase → Project Settings → API → service_role key |
| `OPENAI_API_KEY`             | https://platform.openai.com/api-keys                   |
| `TELEGRAM_BOT_TOKEN`         | @BotFather no Telegram                                |
| `TELEGRAM_ALLOWED_USER_ID`   | Seu user_id do Telegram (pegar com @userinfobot)      |

Variáveis opcionais (deixe comentadas se não usar):

- `SUPABASE_DB_PASSWORD` — só pra `npm run db:apply-migrations` (Supabase → Settings → Database → Database password)
- `INTERNAL_PROCESSING_SECRET` — obrigatório em `NODE_ENV=production`; usado no header `x-internal-processing-secret`
- `TELEGRAM_WEBHOOK_SECRET` + `TELEGRAM_WEBHOOK_URL` — só se usar webhook (o bot de polling não precisa)
- `WEB_SEARCH_API_KEY` + `EXTERNAL_KNOWLEDGE_ENRICHMENT_ENABLED=true` — habilita enrichment via Tavily
- Tudo que está comentado no `.env.example` com flag de feature (memory compiler, extractor v1.4, etc.) — só mexa se souber o que tá fazendo

> ⚠️ **Nunca** commite o `.env`. O `.gitignore` já protege, mas é boa prática
> rodar `git status` antes de qualquer commit pra confirmar.

---

## 4. Aplicar as migrations no Supabase

O projeto tem **migrations incrementais** que ainda não foram aplicadas em
qualquer Supabase novo. Roda:

```bash
npm run db:apply-migrations
```

Esse script lê `supabase/migrations/*.sql` em ordem e aplica o que ainda não
foi aplicado. Se o seu Supabase for o **mesmo** projeto da VM, as migrations
já estão lá — o script é idempotente e vai pular as que já rodaram.

### Se você for criar um Supabase novo do zero:

```bash
npm run db:apply-greenfield-schema   # schema base v1.4
npm run db:apply-incremental-migrations  # tudo que veio depois
```

### Migration crítica do P0 (Observador):

A migration `20260604200000_observer_enable_pgvector.sql` habilita a extensão
`pgvector`. O Supabase **Pro** e **Team** já têm suporte nativo. No **Free**,
também funciona, mas o `ivfflat` index tem limite de tamanho — se der erro
na hora de criar o index, comente a linha `create index ... using ivfflat`
na migration e rode `create index ... using hnsw` em vez disso.

---

## 5. Subir a API

```bash
npm run dev
```

A API sobe em `http://localhost:3000` (ou na porta que você setou em `PORT`).

Health check:

```bash
curl http://localhost:3000/health
```

---

## 6. (Opcional) Subir o bot Observador no Telegram

Esse é o bot novo (`observer-telegram-bot.ts`) que faz retrieval híbrido
(vector + FTS) + rerank + LLM, com confirmação de fontes. É polling, não
precisa de webhook público.

```bash
# Coloque as credenciais num arquivo separado (NÃO comite):
cat > /tmp/observer_env <<EOF
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_USER_ID=...
EOF

chmod 600 /tmp/observer_env

# Roda:
set -a; source /tmp/observer_env; set +a
npx tsx scripts/observer-telegram-bot.ts
```

Os logs vão pra `/tmp/observer-telegram.jsonl` (uma linha JSON por iteração:
input → retrieval → rerank → compose → verify → send → error).

---

## 7. Verificar se tudo tá OK

```bash
npm run verify:env       # confere que as vars mínimas tão setadas
npm run verify:runtime   # confere que migrations críticas tão aplicadas
npm test                 # roda a suite de testes
```

Se `verify:env` reclamar de algo, o app vai subir mesmo assim (algumas
funcionalidades ficam desabilitadas), mas a recomendação é resolver antes.

---

## 8. Comandos úteis do dia a dia

| Comando                              | O que faz                                       |
| ------------------------------------ | ----------------------------------------------- |
| `npm run dev`                        | Sobe a API em modo watch                        |
| `npm test`                           | Roda a suite de testes                          |
| `npm run lint`                       | ESLint                                           |
| `npm run format`                     | Prettier (write)                                |
| `npm run db:apply-migrations`        | Aplica migrations pendentes                     |
| `npm run test:e2e:smoke`             | Smoke test E2E                                  |
| `npm run test:mcp:smoke`             | Smoke test do MCP server                        |
| `npm run test:pipeline:smoke`        | Smoke test do pipeline de extração              |
| `npm run observer-eval`              | Avaliação do Observador (recall@k, MRR)         |
| `npm run observer-backfill-embeddings` | Backfill de embeddings em inbox_items         |

---

## 9. Estrutura básica do repo

```
src/
  server.ts                  # Fastify bootstrap
  mcp/server.ts              # MCP server (8 tools read-only)
  ...                        # pipeline, retrieval, persist, etc.

supabase/
  migrations/                # SQL migrations em ordem cronológica
  migrations_archive/        # versões anteriores (não roda)

scripts/
  ...                        # smoke tests, calibrations, observer

tests/                       # vitest suite
data/bootstrap/              # memoria-inicial.md (gitignored)
public/                      # static files (audit UI v1)
docs/                        # documentação
```

---

## 10. Próximos passos depois que estiver rodando

O **P0** (vector + embeddings + hybrid search RRF) já está no código. Para
subir pra **P1** e **P2** do plano, o caminho é:

1. **P1 — Rerank + query rewriting + entity-grounded**
   - Já tem script `observer-eval.ts` pra medir baseline
   - Adicionar rerank dedicado (Cohere ou LLM-based) na função hybrid
   - Query rewriting antes do embed (multi-query ou HyDE)
   - Entity grounding: filtrar por entities_resolved antes do retrieve

2. **P2 — Sumarização + UI + backfill**
   - `observer-backfill-embeddings.ts` já existe, só falta agendar
   - UI: o esqueleto está em `public/` (audit v1) — expandir pra interface
     completa do Observador
   - Sumarização periódica de itens antigos (cron ou LLM-driven)

---

## 11. Problemas comuns

**`npm install` falha com erro de permissão**
→ Use `nvm` ou troque o ownership do `node_modules`. Nunca rode com `sudo`.

**`verify:env` reclama de `OPENAI_API_KEY` mesmo estando no `.env`**
→ O `.env` é carregado pelo Fastify, não pelo `verify:env`. Rode o verify
com `set -a; source .env; set +a` antes, ou use `dotenv-cli`.

**`pgvector` extension not available**
→ Supabase Free/Pro: habilite em Database → Extensions. Se persistir, rode
manualmente: `create extension if not exists vector;` no SQL editor.

**O bot Observador não responde no Telegram**
→ Confirme que `TELEGRAM_ALLOWED_USER_ID` é o seu (não do bot). Veja os
logs em `/tmp/observer-telegram.jsonl` — o `error` field tem o motivo.

**Migrations aplicadas em duplicata**
→ O `apply-pending-migrations` é idempotente e registra em
`supabase_migrations.schema_migrations`. Se duplicar, limpe manualmente.

---

## 12. Suporte

- **Issues / PRs:** https://github.com/wellersonaaj/segundo-cerebro-tick
- **Esse projeto tem um agente (Claw) que desenvolveu boa parte do código
  com você** — quando travar, abre uma issue ou me chama de volta no chat.

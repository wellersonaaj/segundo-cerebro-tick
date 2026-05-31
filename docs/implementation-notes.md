# Implementation Notes

## Decisões tomadas

### Repositório base

O diretório `segundo-cerebro-tick` continha um scaffold Next.js vazio. Foi **substituído** por API Node/Fastify conforme especificação do MVP, sem descartar histórico git além dos arquivos do template removidos explicitamente.

### Stack

- **Fastify 5** (em vez de Express) — leve, adequado ao Railway
- **OpenAI Responses API** com JSON Schema estrito (`extractor-v1.2`)
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

## Segurança mínima (revisão homologação)

| Requisito | Status |
|-----------|--------|
| `SUPABASE_SERVICE_ROLE_KEY` apenas em `src/db/supabase.ts` (servidor) | OK — não exposta em rotas nem MCP client |
| Endpoint SQL livre | OK — inexistente |
| Tool MCP SQL livre | OK — somente 6 tools de leitura tipadas |
| `raw_content` não confiável | OK — regra no prompt + sem execução de instruções embutidas |
| Exclusão definitiva | OK — nenhum `.delete()` nos repositórios/API |

## Pendências explícitas

- Executar `npm run test:e2e:smoke` com `.env`, migrations 001–002 (+003) e `npm run dev` ativo
- Testes de integração E2E com Supabase real (requer instância configurada)
- Políticas RLS por usuário autenticado (BLG-0103)
- Seed de `Genius Hotels` + alias `Genius` via script ou migration opcional

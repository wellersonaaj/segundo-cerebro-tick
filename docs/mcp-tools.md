# MCP Tools — Segundo Cérebro Memory Server

Transporte: **stdio** (`npm run mcp`)

Somente leitura. Sem SQL livre. Sem escrita.

## search_entities

```json
{ "query": "Genius", "entity_types": [], "limit": 5 }
```

Retorno: `{ "matches": [{ "entity_id", "name", "entity_type", "match_type", "confidence" }] }`

## get_entity_details

```json
{ "entity_id": "uuid" }
```

Retorno: entidade, aliases, eventos recentes, tarefas abertas relacionadas.

## search_recent_mentions

```json
{ "query": "Genius", "days": 90, "limit": 10 }
```

## search_memory

```json
{ "query": "integração Genius", "limit": 10 }
```

## list_open_tasks

```json
{ "query": "fornecedor", "limit": 10 }
```

## list_pending_clarifications

```json
{ "limit": 10 }
```

## Testar com MCP Inspector

```bash
npx @modelcontextprotocol/inspector npx tsx src/mcp/server.ts
```

Defina `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no ambiente do Inspector.

# API Contracts — Segundo Cérebro MVP

Base URL: `http://localhost:3000` (desenvolvimento)

## POST /inbox-items

Captura e processa uma nota ponta a ponta.

**Body**

```json
{
  "raw_content": "string (obrigatório)",
  "source_channel": "manual | chat | ...",
  "source_mode": "conversational | passive",
  "received_at": "ISO 8601 com offset",
  "timezone": "America/Sao_Paulo"
}
```

**Response 201**

```json
{
  "inbox_item_id": "uuid",
  "processing_status": "completed",
  "extractor_version": "extractor-v1.2",
  "entities_created": 0,
  "entities_resolved": 0,
  "events_created": 0,
  "assertions_created": 0,
  "tasks_created": 0,
  "clarifications_pending": 0,
  "clarifications_resolved_automatically": 0,
  "requires_review": false,
  "review_reasons": [],
  "processing_notes": []
}
```

**Erros**

- `400` — validação
- `500` — falha OpenAI ou persistência (`processing_status=failed` no inbox_item)

## GET /inbox-items/:id

Retorna o `inbox_item` original (raw_content preservado).

## POST /inbox-items/:id/corrections

**Body**

```json
{ "correction_text": "Na verdade, não era Bruno. Era Marcelo." }
```

Supersede eventos/assertions/tarefas abertas anteriores e reprocessa com contexto corrigido.

## GET /memory/search?q=

Busca textual em entidades, eventos, assertions, tarefas e menções recentes.

## GET /entities

Lista entidades ativas.

## GET /entities/:id

Detalhes: entidade, aliases, eventos recentes, tarefas abertas relacionadas.

## GET /entities/:id/events

Eventos vinculados à entidade.

## GET /tasks

Query: `status=open`, `q=` (opcional).

## GET /clarifications

Query: `status=pending`.

## POST /clarifications/:id/resolve

**Body:** `{ "answer": "..." }`

## POST /clarifications/:id/dismiss

## GET /health

`{ "status": "ok", "timestamp": "..." }`

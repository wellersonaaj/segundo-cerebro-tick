## Fase 5 — UX polish + /status cost fix

Plano enxuto, 1 commit, foco em observabilidade e UX.

### Fix crítico: /status com cost zerado (já reportado pelo Wellerson)
Bug: `/status` lê `cost_usd` apenas dos `turn_finish` entries, mas estes
ficam zerados quando stages individuais não passam model+tokens via
`stage({model, input_tokens, output_tokens})`.

**Fix 1a (curto prazo):** no `command-handler.service.ts`, somar cost
direto dos stages, não dos turn_finish:
  - /status e /costs: ler TODOS os entries com `cost_usd > 0`, somar
  - Não filtrar por stage='turn_finish'
  - Bonus: mostrar breakdown por stage já existe, só garantir que pega tudo

**Fix 1b (longo prazo, opcional):** garantir que cada chamada LLM passe
`model` + tokens no `stage()`. Auditar `composer.service.ts`,
`verifier.service.ts`, `intent-classifier.service.ts`, `extractor-v1.4.service.ts`
pra confirmar que cada call tem `model` no payload e `input_tokens`/`output_tokens`
na resposta capturada.

### Polish de comandos

**1. /status com inline_keyboard:**
   - 3 botões: "Ver custos" / "Ver últimos 5 turnos" / "Ver erros"
   - Ao clicar, edita a mensagem com o conteúdo pedido
   - Arquivo: src/telegram/telegram-bot.client.ts (adicionar editMessageText helper)

**2. /debug aceita turn_id OU último turno (se omitido):**
   - Se omitido: pega o último turn_finish dos logs de hoje
   - Resposta formatada com markdown, cada stage em bloco ```

**3. /costs retorna tabela por stage (24h):**
   - Já existe, só polir formatação
   - Colunas: stage | total $ | count
   - Ordenado por total desc

**4. /log retorna últimos 20 entries sanitizados:**
   - Remover campos sensíveis (input/output completos se > 500 chars, truncar)
   - Formato: `{ts} | {stage} | {latency_ms}ms | {intent or ""}`

### Tests
- Adicionar `tests/command-handler-cost.test.ts`: mocka logs com cost > 0 em
  stages individuais, valida que /status e /costs somam corretamente
- Atualizar `tests/command-handler.service.test.ts` pro novo formato de /log

### Aceitação
- `npm test` 100% (excluindo o pré-existente)
- /status retorna cost real (não zero) após algumas mensagens com LLM
- /costs tem breakdown por stage
- /debug sem turn_id retorna o último
- Inline keyboard responde aos cliques

### Commit + push
Mensagem: `feat(ux): polish commands + fix /status cost tracking`

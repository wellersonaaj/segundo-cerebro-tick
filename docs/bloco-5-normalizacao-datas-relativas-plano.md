# Bloco 5 — Normalização determinística de datas relativas

**Status:** planejado (doc-only) — **não implementado**  
**Pré-requisito:** semantic gate extractor-v1.4 **approved** (`run_id` `v14-live-2026-06-03T00-20-08-750Z-88484fa2`)  
**Data do plano:** 2026-06-03

---

## 1. Objetivo

Preservar o texto literal recebido pelo extrator e, quando seguro e determinístico, derivar um instante absoluto (`normalizedAt`) para uso do compiler, contexto e persistência futura — **sem inventar precisão** (hora, minuto, ano) que o texto não suporte.

Princípios:

| Princípio | Regra |
|-----------|--------|
| Literal primeiro | `literal` sempre espelha `due_at` (ou campo fonte) exatamente como veio da LLM |
| Não inventar | Sem default de hora (ex. 09:00) salvo regra explícita e documentada para casos de dia inteiro |
| Timezone explícito | Todo cálculo usa `timezone` IANA + `received_at` (ou âncora de ingestão) |
| Ambiguidade explícita | `status: ambiguous` + `reason`; clarification só se material para o pipeline |
| Sem LLM | Normalizador 100% determinístico; testes sem OpenAI |

---

## 2. Escopo

### Dentro (Bloco 5 v1)

- Novo módulo **TemporalNormalizer** (nome proposto), versionado.
- Aplicação inicial **somente** em `task_signals[].due_at` após extração estruturada e **antes** ou **durante** compilação v2 (ponto exato na sequência de implementação).
- Tipos compartilhados de saída (`NormalizedTemporalValue`).
- Suite de testes unitários com matriz de casos mínimos (§6).
- Integração na calibração v1.4 (`run-v14-context-pipeline` / compiler) sem alterar prompt/schema do extrator.
- Materialidade: reutilizar `ambiguous_date` no CM quando normalização for `ambiguous` e decisão de task depender de prazo.

### Fora (explícito)

- Supabase greenfield, migrations, persistência de `CompiledMemoryV2`
- `events[].occurred_at`, `assertions`, compromissos, recorrência
- Context Builder completo
- Segunda LLM
- Runtime produtivo v1.3 → v1.4 / enforce
- Bootstrap pessoal
- Parser de linguagem natural aberto (allowlist de padrões + regras, não NLU genérico)

---

## 3. Modelo de dados proposto

```ts
/** Versão do normalizador (semver ou date-based). */
export const TEMPORAL_NORMALIZER_VERSION = 'temporal-normalizer-v1';

export type TemporalNormalizationStatus =
  | 'resolved'       // normalizedAt preenchido com confiança aceitável
  | 'ambiguous'      // múltiplas interpretações ou texto insuficiente
  | 'not_applicable' // string vazia / null / não é expressão temporal
  | 'failed';        // parse reconhecido mas inválido (data impossível)

export interface NormalizedTemporalValue {
  /** Texto original (ex.: due_at do task_signal). */
  literal: string;
  /** ISO 8601 com offset quando resolved; null caso contrário. */
  normalizedAt: string | null;
  /** IANA, ex.: America/Sao_Paulo */
  timezone: string;
  status: TemporalNormalizationStatus;
  /** 0–1; resolved tipicamente >= 0.85 */
  confidence: number;
  /** Código ou mensagem curta para ambiguous/failed (ex.: missing_year, weekday_without_anchor) */
  reason: string | null;
}
```

### Onde anexar no pipeline (proposta)

```ts
interface CompiledTaskV2 {
  // ... campos existentes ...
  dueAt: string | null;              // literal (inalterado)
  dueAtNormalized?: NormalizedTemporalValue | null;  // novo, opcional na fase 1
}
```

Alternativa mínima: campo paralelo em `MemoryCompilerV2Input` / evidência em `contextResolutionEvidence` — decidir na implementação sem duplicar fonte de verdade.

**Não alterar** o schema OpenAI `due_at: string | null` na v1 do Bloco 5; normalização é pós-extração.

---

## 4. Entradas do normalizador

| Entrada | Obrigatória | Uso |
|---------|-------------|-----|
| `literal` | sim | Texto `due_at` |
| `received_at` | sim | ISO instante de recebimento do inbox (âncora “hoje”) |
| `timezone` | sim | IANA do usuário/canal (ex. `America/Sao_Paulo`) |
| `locale` | opcional | `pt-BR` default para nomes de dia/mês |

---

## 5. Regras de decisão

### 5.1 Quando normalizar automaticamente (`resolved`)

Aplicar somente se **uma** interpretação válida existir:

| Padrão (exemplos) | Regra |
|-------------------|--------|
| `hoje` | Início ou fim do dia civil em `timezone` (documentar: **fim do dia** para prazo de tarefa, salvo override por `operation`) |
| `amanhã` | `received_at` + 1 dia civil |
| `ontem` | `received_at` − 1 dia civil (raro em `due_at`; suportar por simetria) |
| `15/06/2026`, `2026-06-15` | Data absoluta explícita; hora ausente → **não** inventar hora; usar fim do dia civil ou `T00:00:00` com flag `date_only: true` interna |
| `dia 15` | Só se mês/ano inferíveis sem ambiguidade (mês corrente a partir de `received_at`; se dia já passou no mês, próximo mês) — **confidence reduzida** |
| `sexta-feira` / `sexta` | Próxima ocorrência do weekday **estritamente após** `received_at` (se hoje é sexta, próxima sexta = +7d — documentar) |
| `próxima sexta-feira` | Weekday da semana seguinte à semana de `received_at` |
| `segunda-feira às 10h` | Data do próximo Monday + hora explícita `10:00` |

### 5.2 Quando preservar somente literal (`not_applicable` ou `failed`)

| Caso | Status | Motivo |
|------|--------|--------|
| `null`, `""`, só espaços | `not_applicable` | Sem prazo |
| Texto sem token temporal reconhecido (“urgente”, “em breve”) | `not_applicable` ou `ambiguous` | Ver §5.3 |
| Data impossível (`31/02/2026`) | `failed` | `impossible_date` |
| Fora do allowlist e sem match | `not_applicable` | Deixar compiler/CM tratar como hoje |

### 5.3 Quando marcar `ambiguous`

| Caso | `reason` exemplo |
|------|------------------|
| `dia 15` sem mês e duas interpretações plausíveis no horizonte | `missing_month` |
| `sexta` com política de “esta semana vs próxima” incerta | `weekday_anchor_unclear` (preferir regra fixa §5.1 e confidence ≥ 0.85; se não, ambiguous) |
| `10h` sem dia | `missing_date` |
| Dois padrões conflitantes no mesmo literal | `conflicting_tokens` |

### 5.4 Quando pedir clarification (`ambiguous_date`)

Somente quando **material** para o pipeline:

- `operation` ∈ `update_due_date`, `create` com expectativa de prazo na calibração, **e**
- `status === 'ambiguous'` **ou** (`status === 'failed'` e política exigir confirmação), **e**
- `TaskContextResolver` não resolveu target de outra forma

**Não** pedir clarification para:

- `ambiguous_date` em enrichment de `create` já coberto por CM (registrável sem prazo absoluto)
- `not_applicable` (sem data no texto)
- `resolved` com confidence ≥ limiar (ex. 0.85)

Alinhar com `ClarificationManagerV2`: `ambiguous_date` non-blocking quando contexto incremental já resolveu due date (regra existente).

### 5.5 Evitar inventar horário

- Hora só se explícita (`às 10h`, `10:30`, `14h`).
- Data sem hora → `normalizedAt` em **fim do dia civil** (`23:59:59.999`) ou início (`00:00:00`) — **uma política única** documentada no código; preferência produto: **fim do dia** para prazo de entrega.

### 5.6 Data sem ano

- `15/06` → ano = ano de `received_at`; se data < `received_at` no calendário, ano seguinte.
- `dia 15` → mês corrente; se dia < hoje, mês seguinte; se ainda ambíguo (ex. 31 em fev), `ambiguous` ou `failed`.

### 5.7 Dia da semana

- Normalizar acentos e case (`sexta-feira`, `Sexta`).
- “Próxima” / “essa” como modificadores com regras fixas (tabela §5.1).
- Não usar feriados ou calendário de negócio neste bloco.

### 5.8 Timezone

- Todo instante em ISO 8601 com offset derivado de `timezone` (via `Intl` / `Temporal` ou lib consolidada).
- Não converter para UTC silenciosamente sem registrar offset no `normalizedAt`.
- `received_at` interpretado no mesmo `timezone` salvo metadado contrário no ingestion context.

### 5.9 Versionamento

- `TEMPORAL_NORMALIZER_VERSION` em constante exportada.
- Relatórios de calibração podem incluir versão do normalizador ao lado de `extractor-v1.4`.
- Mudança de regra semântica → bump minor; breaking → major.

---

## 6. Casos mínimos (matriz de testes)

| # | Entrada | `received_at` (ex.) | `timezone` | Resultado esperado |
|---|---------|---------------------|------------|-------------------|
| 1 | `amanhã` | 2026-06-03T15:00:00-03:00 | America/Sao_Paulo | `resolved`, dia 2026-06-04 |
| 2 | `hoje` | idem | idem | `resolved`, dia 2026-06-03 |
| 3 | `ontem` | idem | idem | `resolved`, dia 2026-06-02 |
| 4 | `sexta-feira` | 2026-06-03 (terça) | idem | `resolved`, próxima sexta 2026-06-06 |
| 5 | `próxima sexta-feira` | 2026-06-03 (terça) | idem | `resolved`, sexta da semana seguinte |
| 6 | `segunda-feira às 10h` | 2026-06-03 | idem | `resolved`, com hora 10:00 |
| 7 | `dia 15` | 2026-06-03 | idem | `resolved` ou `ambiguous` (documentar política) |
| 8 | `15/06/2026` | qualquer | idem | `resolved`, 2026-06-15 |
| 9 | `urgente` | qualquer | idem | `not_applicable` |
| 10 | `31/02/2026` | qualquer | idem | `failed` |
| 11 | `America/Sao_Paulo` + âncora | — | — | testes de offset DST se aplicável |
| 12 | `received_at` conhecido | fixo em fixture | idem | regressão determinística |

Testes em `tests/temporal-normalizer.test.ts` (proposto); fixtures JSON em `data/calibration/temporal-normalizer-v1/cases/`.

---

## 7. Arquivos propostos (implementação futura)

| Arquivo | Responsabilidade |
|---------|------------------|
| `src/services/temporal-normalizer.types.ts` | `NormalizedTemporalValue`, status, version |
| `src/services/temporal-normalizer.service.ts` | Parser determinístico (allowlist pt-BR) |
| `src/services/temporal-normalizer.patterns.ts` | Tokens / regex documentados |
| `tests/temporal-normalizer.test.ts` | Matriz §6 |
| `data/calibration/temporal-normalizer-v1/manifest.json` | Casos offline |
| `scripts/run-temporal-normalizer-calibration.ts` | Opcional: relatório sem OpenAI |

**Integração (fase 2 do bloco):**

| Arquivo | Mudança |
|---------|---------|
| `src/services/memory-compiler-v2.service.ts` | Chamar normalizer em `compileTaskSignals` para `due_at` |
| `src/calibration/extractor-v1.4/run-v14-context-pipeline.ts` | Passar `received_at` + `timezone` do case file |
| `src/types/memory-compiler-v2.ts` | Campo opcional `dueAtNormalized` |
| `src/calibration/extractor-v1.4/fixed-calibration-expectations.ts` | Expectativas `normalizedAt` onde aplicável |

**Não modificar na fase 1:** `extractor-v1.4.prompt.ts`, `extractor-v1.4.schema.ts`, `ClarificationManagerV2` (salvo wiring de `received_at` se ausente).

---

## 8. Riscos

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Política “sexta” vs “próxima sexta” divergir do usuário | Falso prazo | Regras fixas + testes; ambiguous quando modificador ausente e anchor unclear |
| Inventar hora em data sem hora | Prazo errado | Política fim/início de dia explícita; nunca 09:00 default |
| DST / timezone | Offset errado | Testes com `America/Sao_Paulo`; usar API timezone-aware |
| Regressão semantic gate | Gate fail | Rodar gate subset `incremental_due_date_*` após integração |
| Duplicar fonte de verdade | Drift literal vs normalized | `due_at` literal imutável; normalized só derivado |

---

## 9. Critérios de aceite (Bloco 5)

- [ ] `npm test` — suite `temporal-normalizer` ≥ 12 casos §6 verdes
- [ ] `npm run test:extractor:v1.4:fixed` e `:context` sem regressão
- [ ] `npm run test:extractor:v1.4:live -- --categories=incremental_due_date_unique,incremental_due_date_ambiguous --repetitions=3` — sem aumento de `false_blocking_clarification_rate`
- [ ] Literal `due_at` preservado byte-a-byte no compiled output
- [ ] `normalizedAt` null quando `ambiguous` / `failed` / `not_applicable`
- [ ] Nenhuma migration / persistência / enforce neste bloco
- [ ] Documentação: versão do normalizador em `changelog-arquitetural.md`

---

## 10. Sequência de implementação sugerida

1. **Tipos + normalizer puro** — sem integração; 100% testes unitários.
2. **Fixtures de calibração** — JSON + runner offline.
3. **Wire no compiler v2** — só `task_signals[].due_at`; passar `received_at` / `timezone` do case de calibração.
4. **Ajuste fino CM** — garantir `ambiguous_date` material só quando normalizer `ambiguous` e target não resolvido.
5. **Live barato** — 2 categorias incrementais × 3 rep.
6. **Doc + changelog** — marcar Bloco 5 done na v1.2.
7. **(Futuro)** Gate amplo opcional pós-estabilização; depois `occurred_at` em bloco separado.

---

## 11. Decisão de produto (registrada)

```text
semantic gate v1.4 → approved

próximo bloco → normalização determinística de datas relativas (este plano)

não implementar automaticamente até aprovação explícita do escopo da fase 1
```

---

## 12. Referências

- Gate aprovado: `docs/extractor-v1.4-spec.md` §12.1
- Regras CM / `ambiguous_date`: `docs/regras_canonicas_ingestao_contexto_clarificacoes_v1.md`
- Backlog: `docs/backlog_segundo_cerebro_pessoal_v1.2.md` — BLG-v12-5

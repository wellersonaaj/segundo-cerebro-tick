# Regras canônicas — normalização temporal v1

**Status:** ativo para `TemporalNormalizer` v1.0.0 (Blocos 5A + 5B + 5C).  
**Escopo:** normalização determinística pós-extração; **somente** `due_at` literal de tarefas via Memory Compiler v2 (calibração / shadow).  
**Não aplicado** ao runtime produtivo v1.3, Memory Compiler v2, Clarification Manager v2 ou persistência.

---

## 1. Princípios

| Princípio | Regra |
|-----------|--------|
| Literal primeiro | `NormalizedTemporalValue.literal` espelha o texto recebido **sem trim** na saída |
| Não inventar horário | Data sem hora explícita → `precision: date`, `instant: null` |
| Timezone explícito | Todo cálculo usa IANA + `received_at` como âncora |
| Determinístico | Sem LLM; versão semver auditável |
| Passado explícito | Datas absolutas no passado **não** são empurradas para o futuro |

---

## 2. Entradas

```ts
interface TemporalNormalizationInput {
  literal: string | null | undefined;
  receivedAt: string;       // ISO 8601 com offset
  timezone?: string | null; // IANA; ausente → America/Sao_Paulo
  locale?: string;          // reservado; default pt-BR
}
```

---

## 3. Timezone

| Caso | Comportamento |
|------|----------------|
| `timezone` ausente ou vazio | `America/Sao_Paulo`, `timezoneSource: default` |
| `timezone` IANA válido | usado como informado, `timezoneSource: envelope` |
| `timezone` inválido | `status: failed`, `reasonCode: timezone_invalid`, **sem fallback silencioso** |

---

## 4. Saídas por precisão

### 4.1 Data sem horário

```text
precision       = date
localDate       = YYYY-MM-DD
localTime       = null
instant         = null
dueDateBoundary = null
```

### 4.2 Datetime explícito

Horário só quando explícito (`às 10h`, `as 10:30`, `10h` após weekday).

```text
precision       = datetime
localDate       = preenchido
localTime       = HH:mm:ss
instant         = ISO 8601 UTC derivado do TZ
dueDateBoundary = exact
```

### 4.3 Outros status

`ambiguous`, `failed`, `not_applicable` → `instant: null`.

---

## 5. Dias relativos

| Expressão | Regra |
|-----------|--------|
| `hoje` | Dia civil de `received_at` no TZ |
| `amanhã` / `amanha` | +1 dia civil |
| `ontem` | −1 dia civil |

### 5.1 Relativo com horário (`relative_with_time`)

Padrão canônico `matchedPatternId: relative_with_time`.

| Entrada (exemplos) | Saída |
|--------------------|--------|
| `amanhã às 10h` | `precision: datetime`, `localDate` = dia de amanhã, `localTime: 10:00:00`, `instant` preenchido, `dueDateBoundary: exact` |
| `amanha as 10h` | Idem (sem acento) |
| `amanhã 10h` | Idem (forma compacta) |
| `amanhã às 10:30` | `localTime: 10:30:00` |
| `hoje às 14h`, `ontem as 9h` | Mesma regra com offset relativo |

| Entrada inválida | Saída |
|------------------|--------|
| `amanhã às 25h` | `status: failed`, `reasonCode: impossible_time`, `instant: null` |

Variantes suportadas: `às` / `as`, com ou sem `h` final, minutos com `:`.

---

## 6. Dias da semana

Semana civil **ISO**: segunda a domingo.

### 6.1 Weekday sem modificador

`sexta-feira`, `sexta`, `segunda`, …

→ próxima ocorrência **estritamente futura** do weekday.  
→ se hoje **já** for esse weekday → **+7 dias**.

### 6.2 Esta / essa

`esta sexta`, `essa sexta-feira`, …

→ weekday da **semana corrente** (ISO).  
→ se já passou na semana → mesma regra de próxima ocorrência futura (+7 se hoje for o dia).

### 6.3 Próxima

`próxima sexta-feira`, `proxima quarta`, …

→ weekday da **próxima semana ISO** (segunda da semana seguinte + offset).

### 6.4 Com horário

`<weekday> às 10h`, `as 10:30`, `10h` → data do weekday (regra 6.1) + hora explícita → `datetime`.

---

## 7. Datas parciais e absolutas

| Padrão | Regra |
|--------|--------|
| `15/06/2026` | Absoluta; `implicitYear/Month: false` |
| `15/06` | Ano inferido de `received_at`; se data &lt; hoje no ano → ano+1 |
| `dia 15` | Mês inferido; se dia &lt; hoje → mês+1 (com virada de ano) |
| Data passada com ano explícito | Preservada no passado |

Datas impossíveis (`31/02/2026`, `dia 31` em fevereiro) → `failed` / `impossible_date`.

---

## 8. Expressões vagas

| Expressão | Status | `reasonCode` |
|-----------|--------|--------------|
| `no fim da semana` | `ambiguous` | `vague_expression` |
| `mais tarde`, `depois`, `em breve` | `not_applicable` | `vague_expression` |
| `na próxima etapa` | `not_applicable` | `no_temporal_tokens` |

---

## 9. Inválidos

| Expressão | Status | `reasonCode` |
|-----------|--------|--------------|
| `31/02/2026` | `failed` | `impossible_date` |
| `amanhã às 25h` | `failed` | `impossible_time` |

Ver também §5.1 para variantes válidas de relativo + horário.

---

## 10. Versionamento

```text
normalizerId      = temporal-normalizer
normalizerVersion = 1.0.0 (semver)
```

Bump **minor** para novos padrões; **major** para mudança semântica de regras existentes.

---

## 11. Legado

[`src/utils/temporal.ts`](../src/utils/temporal.ts) permanece **congelado** para pipeline v1.3 (`T12:00:00` default).  
**Não reutilizar** no normalizador v1.

---

## 12. Calibração offline (Bloco 5B)

| Artefato | Caminho |
|----------|---------|
| Casos canônicos | `data/calibration/temporal-normalizer/cases.json` |
| Baseline congelada | `data/calibration/temporal-normalizer/v1.0.0-baseline.json` |
| Runner | `npm run calibrate:temporal:normalizer` |
| Compare baseline | `npm run calibrate:temporal:normalizer -- --compare-baseline` |
| Regenerar baseline | `npm run calibrate:temporal:normalizer -- --write-baseline` |
| Relatórios | `artifacts/calibration/temporal-normalizer-v1-report.json`, `temporal-normalizer-v1-summary.md` |

Comparação baseline ignora `reasonDetail` (somente diagnóstico).

---

## 13. Integração Memory Compiler v2 (Bloco 5C)

```text
task_signals[].due_at
  → CompiledTaskV2.dueAt (literal byte-a-byte)
  → TemporalNormalizerService (se temporalAnchor presente)
  → CompiledTaskV2.dueAtTemporal
```

| Condição | `dueAtTemporal` |
|----------|-----------------|
| `dueAt` vazio | `null` |
| `dueAt` + `temporalAnchor` | resultado do normalizer |
| `dueAt` sem `temporalAnchor` | `status: failed`, `reasonCode: missing_temporal_anchor`, `instant: null` |

`MemoryCompilerV2Input.temporalAnchor`:

```ts
{ receivedAt: string; timezone?: string | null }
```

Calibração v1.4 usa default `CALIBRATION_DEFAULT_TEMPORAL_ANCHOR` quando o case não declara anchor. Shadow produtivo passa anchor **somente** se `inbox.received_at` existir (sem inventar silenciosamente).

Log shadow seguro (`extractor_v14_shadow`): `temporal_status`, `temporal_precision`, `temporal_reason_code`, `temporal_normalizer_version`, `timezone_source` — sem literal, instant completo ou PII.

---

## 14. Fora de escopo v1

- `events[].occurred_at`, assertions, recorrência, feriados
- Clarification Manager v2 (inalterado)
- Persistência Supabase / runtime produtivo v1.3
- NLP amplo além da allowlist

---

## 15. Referências

- Plano geral: [`bloco-5-normalizacao-datas-relativas-plano.md`](bloco-5-normalizacao-datas-relativas-plano.md)
- Tipos: [`src/types/temporal-normalization.ts`](../src/types/temporal-normalization.ts)
- Implementação: [`src/services/temporal-normalizer.service.ts`](../src/services/temporal-normalizer.service.ts)
- Calibração: [`src/calibration/temporal-normalizer/`](../src/calibration/temporal-normalizer/)
- Testes: [`tests/temporal-normalizer.test.ts`](../tests/temporal-normalizer.test.ts)

# Compiler baseline (shadow v1)

Baseline produtivo congelado enquanto o Memory Compiler opera em shadow mode.

## Versões

| Campo | Valor |
|-------|--------|
| `extractor_version` | `extractor-v1.3` |
| `schema_version` | `1.3` |
| `prompt_version` | `extractor-v1.3` |
| `memory_compiler_version` | `memory-compiler-v1` (shadow apenas) |

Constantes: [`src/openai/extractor.prompt.ts`](../src/openai/extractor.prompt.ts).

## Pipeline transacional homologado (inalterado)

1. `start_extraction_run` → extração OpenAI → `MemoryResolverService`
2. `applyPostResolutionSanitization` (produtivo)
3. `bootstrap-assertion-review` quando aplicável
4. `persistCandidates` → `promote_extraction_run`

Preservados: runs versionados, candidate lifecycle, RPCs start/promote/fail, `active_extraction_run_id`, `latest_extraction_run_id`, `inbox_item_entities`, `entity_alias_evidences`, `EffectiveInputBuilder`, correções e reprocessamentos.

## Shadow mode

- `MEMORY_COMPILER_MODE=off` (default): sem compiler.
- `MEMORY_COMPILER_MODE=shadow`: compiler paralelo após sanitizer/bootstrap, **antes** de `persistCandidates`; falhas do compiler não bloqueiam promoção.
- `MEMORY_COMPILER_MODE=enforce`: falha com `MEMORY_COMPILER_ENFORCE_NOT_IMPLEMENTED`.

Persistência produtiva: [`src/services/persistence.service.ts`](../src/services/persistence.service.ts) — não alterada pelo compiler nesta fase.

## Calibração

Dataset: [`data/calibration/compiler-v1/`](../data/calibration/compiler-v1/).

```bash
npm run test:compiler:calibration
```

Relatório local: `artifacts/calibration/compiler-v1-report.json` (gitignored).

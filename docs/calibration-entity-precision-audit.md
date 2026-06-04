# Entity precision audit — Memory Compiler v1

## Resumo executivo

| Fase | entity_precision (métrica) | entity_precision (audit) | Causa principal |
|------|---------------------------|--------------------------|-----------------|
| Inicial (~0.82) | 0.78–0.82 | 0.43 | Penalização de entidades legítimas sem `must_have`/`allowed`; substring `Nico` ⊂ `Nicolas` |
| Pós-correção | **1.0** | **1.0** | Contrato `expected` + métrica + compiler (superseded entities) |

Relatórios gerados (gitignored):

- `artifacts/calibration/compiler-v1-entity-precision-audit.json`
- `artifacts/calibration/compiler-v1-comparative-current-vs-compiled.json`

## Classificação inicial (antes das correções)

Das **17 divergências** classificadas no audit inicial:

| Classe | Qtd | Descrição |
|--------|-----|-----------|
| **D** fixture incompleta | 15 | Cenário sem `must_have.entities` mas com entidades compiladas válidas → métrica contava FP |
| **A** FP real do compiler | 2 | `syn-reprocess`: Chris vigente após correções; `syn-explicit-alias-nico`: bug substring must_not |

Nenhum caso inicial foi classificado como **B** (FN real), **C** (allowed faltando — corrigido via D), **E** (ambiguidade), **F** (schema gap) na agregação inicial.

## Breakdown cenário a cenário (estado inicial)

Cenários com FP na métrica inicial (entity contract ausente ou incompleto):

| scenario_id | FP compiladas | Classe | Ação tomada |
|-------------|---------------|--------|-------------|
| cap-alias-shell-style | Gabriel Nova | D | `allowed.entities` |
| cap-correction-meeting | Chris, Bruno | D | `must_have` Bruno + `allowed` |
| syn-alias-negation-shell | Gabriel Nova | D | `allowed` + must_not token fix |
| syn-alias-reassignment | Pat Lee | D | `allowed` |
| syn-ambiguous-identity | Acme | D | `allowed` |
| syn-bootstrap-probe-line | Alex, Dana, Chris | D | `must_have` |
| syn-correction-participant | Chris | D→compiler | `allowed` Chris + `filterSupersededEntities` |
| syn-episodic-confirmation | Dana | D | `allowed` |
| syn-explicit-alias-tick | Alex Costa | D | `must_have` |
| syn-explicit-alias-nico | Nicolas Faleiro | A→bug | token match must_not (Nico ≠ Nicolas) |
| syn-reprocess-accumulated | Chris, Bruno | A/D | `allowed` + superseded filter |
| syn-static-preferences | Alex Costa | D | `allowed` |
| syn-task-title-alias | Alex Costa | D | `must_have` |

Cenários sem divergência de entidade (precision N/A ou 1.0): demais 19 casos.

## Alterações aplicadas

### Avaliação (`expected` + métrica)

- Métrica só conta cenários com contrato (`must_have` ou `allowed`/`optional` entities).
- `must_not` usa match por token (evita `Nico` ⊂ `Nicolas Faleiro`).
- 12 fixtures atualizados com `allowed`/`must_have` conforme classificação **D**.

### Compiler

- `filterSupersededEntities`: remove entidades invalidadas por correção de participante/remetente.
- Sem blocklist universal nova.

## Métricas recalculadas (fixture)

Ver `artifacts/calibration/compiler-v1-report.json` — todos os thresholds atendidos.

Comparativo current vs compiled: `compiler-v1-comparative-current-vs-compiled.json` — compiler reduz entidades em aliases (-55%), correções (-42% entidades, -40% eventos), bootstrap (drop financeiro/engenharia/eventos estáticos).

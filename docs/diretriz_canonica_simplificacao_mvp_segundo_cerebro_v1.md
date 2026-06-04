# Diretriz Canônica de Simplificação do MVP — Segundo Cérebro

**Status:** vigente  
**Versão:** 1.0  
**Data de adoção:** 2026-06-03  
**Natureza:** diretriz arquitetural e de produto  
**Aplicabilidade:** ingestão, resolução semântica, compilação de memória, clarificações, persistência e evolução do MVP

---

## 1. Motivo da diretriz

O projeto atingiu um nível relevante de maturidade técnica, com:

- extractor-v1.4 estruturado;
- Memory Compiler v2;
- Clarification Manager v2;
- Ingestion Context;
- resolução contextual de tarefas;
- normalização temporal determinística;
- schema greenfield;
- persistência v2 em homologação;
- semantic gate amplo aprovado;
- e2e smoke greenfield aprovado.

Durante o pipeline smoke ampliado, um caso de correção simples revelou um risco de overengineering:

```text
Marcelo participou da reunião sobre a integração.
Na verdade, Bruno participou da reunião.
```

A correção principal `Marcelo → Bruno` funcionou, mas a ingestão foi bloqueada por uma ambiguidade periférica ligada a termos como `reunião` e `integração`.

Esse caso mostrou que o sistema estava tentando canonizar detalhes semânticos demais durante a escrita da memória.

---

## 2. Nova diretriz central

```text
Capture primeiro.
Canonize progressivamente.
Bloqueie somente quando houver risco real.
```

O MVP não deve buscar compreensão semântica perfeita no momento da ingestão.

O MVP deve garantir:

1. preservação da fonte original;
2. extração de memória útil;
3. integridade estrutural;
4. segurança para ações externas;
5. auditabilidade;
6. reprocessamento futuro;
7. evolução com base em casos reais.

---

## 3. Objetivo do MVP

O sistema deve ser:

```text
útil
seguro
auditável
reprocessável
simples o suficiente para evoluir
```

O objetivo não é:

```text
toda informação nascer perfeitamente canonizada
```

O objetivo é:

```text
nenhuma informação relevante ser perdida
nenhuma ação insegura acontecer silenciosamente
nenhum erro de integridade ser promovido
```

---

## 4. Arquitetura simplificada

### 4.1. Fonte imutável

Sempre preservar:

```text
raw_content
source_channel
source_mode
source_reference
received_at
timezone
metadata
threads
correções
```

A origem nunca deve ser sobrescrita silenciosamente.

### 4.2. Extração LLM permissiva

A LLM extratora propõe:

```text
entities principais
aliases
events episódicos
tasks
assertions
correction_signals
clarification_candidates
```

A ingestão não deve travar por incerteza periférica.

### 4.3. Determinístico somente para integridade

Manter regras determinísticas quando a regra for objetiva, verificável e necessária para evitar corrupção ou ação insegura.

Exemplos:

```text
task mutation sem target
→ rejeitar

data impossível
→ failed

timezone inválido
→ failed

alias negado ainda ativo
→ impedir

SOURCE_BLOCK inexistente
→ rejeitar artefato

external_action sem target
→ bloquear ação

promoção parcial
→ impedir
```

### 4.4. Revisão semântica sob demanda

Quando houver ambiguidade semântica residual:

```text
persistir memória principal quando seguro
marcar needs_review
seguir adiante
```

Uma futura LLM revisora por exceção pode tratar casos complexos.

Não implementar uma segunda LLM como etapa obrigatória de todas as mensagens.

---

## 5. Registry canônico restrito no MVP

Promover automaticamente como entidades canônicas apenas tipos claramente úteis:

```text
person
company
project
product
```

Avaliar separadamente:

```text
place
```

Não promover automaticamente como entity:

```text
topic
meeting
integration
department
generic term
contrato
homologação
sprint
financeiro
fornecedor genérico
```

Esses elementos podem permanecer como:

```text
texto
descrição
keyword
tag
subject
atributo
source_excerpt
```

---

## 6. Ambiguidade principal versus periférica

### 6.1. Ambiguidade principal

Afeta o artefato principal ou uma ação material.

Exemplos:

```text
qual Bruno?
qual fornecedor deve ser cobrado?
qual tarefa deve ter prazo alterado?
qual destinatário receberá o e-mail?
```

Comportamento:

```text
needs_review
clarification
ou bloqueio da ação
```

### 6.2. Ambiguidade periférica

Afeta termo secundário, descrição ou tópico incidental.

Exemplos:

```text
“reunião sobre integração” é tópico ou projeto?
“financeiro” é departamento ou assunto?
“homologação” é status ou tópico?
```

Comportamento:

```text
não bloquear promote
registrar warning quando útil
preservar texto
reprocessar futuramente se necessário
```

---

## 7. Política simplificada de clarificações

### 7.1. External action

```text
external_action
→ bloqueia execução até resolver
```

### 7.2. Task execution

```text
task_execution
→ não bloqueia promoção da memória
→ mantém pendência para execução futura
```

### 7.3. Knowledge confirmation

```text
knowledge_confirmation
→ não deve bloquear ingestão inteira por padrão
→ bloquear somente quando a incerteza comprometer o artefato principal
```

### 7.4. Enrichment

```text
enrichment
→ non_blocking
```

---

## 8. Correções

Regra simplificada:

```text
correction_signal explícito
+ subject anterior resolvido
+ subject atual resolvido
→ aplicar correção

ambiguidade periférica
→ não bloquear promote
```

Exemplo:

```text
Marcelo participou.
Na verdade, Bruno participou.
```

Resultado esperado:

```text
Marcelo
→ superseded

Bruno
→ active

ambiguidade sobre “reunião sobre integração”
→ periférica
→ não bloqueia correção
```

---

## 9. Determinístico versus LLM

| Situação | Abordagem |
|---|---|
| Integridade referencial | determinística |
| Lifecycle e promoção | determinística |
| Datas relativas suportadas | determinística |
| Constraints e idempotência | determinística |
| Alias negado ativo | determinística |
| Ação externa insegura | determinística |
| Extração semântica inicial | LLM extratora |
| Ambiguidade periférica | persistir + needs_review ou ignorar |
| Contradição semântica complexa | futura LLM revisora por exceção |
| Classificação rica de texto secundário | adiar |

---

## 10. Critério para futura LLM revisora

Somente considerar implementação quando houver um dataset real mínimo de casos residuais recorrentes.

A revisora deve rodar por exceção, não em todas as mensagens.

Casos candidatos:

```text
correção explícita com conflito residual
contradição semântica não resolvível por regra curta
identidade contextual complexa
fact versus opinion quando material
escopo implícito relevante
```

A revisora não pode:

```text
persistir diretamente
apagar histórico
ignorar constraints
executar ação externa
alterar lifecycle livremente
```

---

## 11. Simplificação do roadmap imediato

### S1 — Simplificar registry e materialidade (implementado)

Política consolidada:

```text
registry automático MVP: person, company, project, product (sem location)
entity_mentions fora da lista → dropped + compilerNotes (peripheral_ambiguity_ignored)
ambiguidade de identidade só materializa clarificação se registry-eligible
Clarification Manager: KC periférica e task_execution → non_blocking
promote_extraction_run: bloqueia só external_action (materiality=blocking, pending)
warnings periféricos em compilerNotes / compiled_output (sem nova tabela)
```

### S2 — Ajustar persistência e cenário de correção

```text
promover memória principal segura
manter needs_review periférico
validar cenário Marcelo → Bruno
```

### S3 — Fechar homologação funcional

```text
pipeline smoke completo
bootstrap controlado
importação do panorama inicial
uso real assistido
```

---

## 12. Critério de saída do MVP

O MVP está pronto para uso real quando:

```text
fonte original preservada
entidades principais recuperáveis
tarefas registráveis
correções básicas funcionam
ações externas inseguras bloqueadas
ambiguidades periféricas não travam ingestão
dados podem ser reprocessados
pipeline smoke passa
bootstrap controlado passa
```

---

## 13. Regras de governança para evitar overengineering

Antes de adicionar regra determinística nova, responder:

1. A regra protege integridade ou segurança?
2. A regra é curta, geral e verificável?
3. O problema apareceu em casos reais recorrentes?
4. O problema pode ser apenas registrado como `needs_review`?
5. A regra reduz complexidade total?

Se a resposta for negativa, não adicionar novo `if`.

---

## 14. Status atual

```text
semantic gate extractor-v1.4
→ approved

temporal normalizer v1
→ approved

schema greenfield
→ implementado

e2e smoke greenfield
→ approved

pipeline smoke ampliado
→ em validação (cenário 7 desbloqueado por S1; smoke 15/15 → S3)

S1 registry + materialidade
→ implementado

S1.1 hardening operacional
→ migration incremental + smokes greenfield

nova diretriz
→ vigente
```

---

## 15. Frase operacional

```text
Capture primeiro.
Canonize progressivamente.
Bloqueie somente quando houver risco real.
```

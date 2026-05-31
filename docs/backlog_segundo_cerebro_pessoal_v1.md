# Segundo Cérebro Pessoal com Agentes de IA
## Backlog Canônico do Projeto

**Status:** backlog inicial para evolução incremental do MVP  
**Versão:** 1.0  
**Data:** 31/05/2026  
**Objetivo:** registrar o que já foi decidido, o que está em andamento e o que ainda precisa ser implementado, sem confundir backlog com documentação arquitetural.

---

# 1. Como usar este documento

Este arquivo complementa o documento canônico de arquitetura.  
A arquitetura define os princípios e decisões estruturais.  
Este backlog define o trabalho ainda necessário para transformar esses princípios em produto funcional.

Regras de manutenção:

- atualizar o status dos itens conforme a execução;
- criar novos itens quando surgirem necessidades reais;
- evitar detalhamento excessivo antes da validação prática;
- registrar decisões arquiteturais relevantes em ADR separado;
- não considerar um item concluído sem critério de aceite verificável.

Status possíveis:

```text
backlog
ready
in_progress
blocked
done
cancelled
```

Prioridades:

```text
P0 = necessário para continuar validando o núcleo
P1 = necessário para fechar o MVP utilizável
P2 = importante após validação do MVP
P3 = evolução futura
```

---

# 2. Visão resumida das fases

| Fase | Objetivo | Status |
|---|---|---|
| Fase 0 | Consolidar baseline arquitetural | done |
| Fase 1A | Criar schema inicial no Supabase | done |
| Fase 1B | Calibrar o Inbox Processor | in_progress |
| Fase 1C | Capturar e persistir entrada estruturada | backlog |
| Fase 1D | Permitir correção e reprocessamento | backlog |
| Fase 1.5 | Detectar e organizar pedidos de esclarecimento | backlog |
| Fase 2 | Recuperação básica da memória | backlog |
| Fase 3 | Busca semântica e recuperação híbrida | backlog |
| Fase 4 | Briefing diário | backlog |
| Fase 5 | Ações assistidas com aprovação | backlog |
| Fase 6 | Integrações adicionais | backlog |

---

# 3. Fase 0: baseline arquitetural

## BLG-0001 - Consolidar arquitetura canônica

**Prioridade:** P0  
**Status:** done

**Descrição:**  
Centralizar os princípios, camadas, tabelas iniciais, limites do MVP, ADRs iniciais e roadmap macro.

**Critério de aceite:**  
Documento canônico anexado ao projeto e utilizado como referência principal.

---

# 4. Fase 1A: schema inicial no Supabase

## BLG-0101 - Criar projeto Supabase

**Prioridade:** P0  
**Status:** done

## BLG-0102 - Executar migration inicial

**Prioridade:** P0  
**Status:** done

**Escopo esperado:**

```text
inbox_items
events
entities
event_entities
assertions
tasks
policies
```

## BLG-0103 - Validar RLS mínimo das tabelas

**Prioridade:** P1  
**Status:** backlog

**Descrição:**  
Confirmar que Row Level Security está habilitado e que os acessos usados pelo workflow estão controlados.

**Critério de aceite:**  
As tabelas não ficam abertas para acesso público indevido.

---

# 5. Fase 1B: calibração do Inbox Processor

## BLG-0201 - Congelar extractor-v1 como baseline

**Prioridade:** P0  
**Status:** ready

**Descrição:**  
Preservar o prompt, JSON Schema, payload e resposta do primeiro teste para permitir comparação entre versões.

**Critério de aceite:**  
Existe uma cópia identificável como `extractor-v1` que não será sobrescrita.

## BLG-0202 - Criar extractor-v1.1

**Prioridade:** P0  
**Status:** ready

**Descrição:**  
Adicionar regras para evitar datas inventadas, reduzir revisões irrelevantes e gerar pedidos estruturados de esclarecimento.

**Critério de aceite:**  
O novo prompt possui as regras adicionais descritas no guia de alteração imediata.

## BLG-0203 - Adicionar clarification_requests ao JSON Schema

**Prioridade:** P0  
**Status:** ready

**Descrição:**  
Permitir que o Inbox Processor registre dúvidas relevantes sem perguntar diretamente ao usuário.

**Critério de aceite:**  
A resposta estruturada sempre contém:

```json
"clarification_requests": []
```

Quando houver ambiguidade relevante, o array contém objetos válidos conforme schema.

## BLG-0204 - Adicionar metadados de origem ao input do extrator

**Prioridade:** P0  
**Status:** ready

**Descrição:**  
Enviar no input do modelo a origem da mensagem e o modo de entrada.

**Campos iniciais:**

```text
source_channel
source_mode
received_at
timezone
```

**Valores iniciais para source_mode:**

```text
conversational
passive
```

**Critério de aceite:**  
O modelo recebe os metadados em todos os testes.

## BLG-0205 - Reexecutar o primeiro cenário no extractor-v1.1

**Prioridade:** P0  
**Status:** backlog

**Entrada esperada:**

```text
Conversei com o Bruno sobre a integração da Genius.
Acho que a liberação do IP pode atrasar.
Preciso cobrar o fornecedor amanhã.
```

**Critérios de aceite:**

```text
evento de conversa criado
occurred_at do evento = null
Bruno criado como person
Genius criada como other
hipótese de atraso criada
 tarefa de cobrar fornecedor criada com due_at resolvido
clarification_request sobre o tipo de Genius
clarification_request sobre qual fornecedor cobrar
nenhuma revisão apenas porque “fornecedor” não virou entidade
```

## BLG-0206 - Executar bateria curta direcionada

**Prioridade:** P0  
**Status:** backlog

**Descrição:**  
Executar de 10 a 15 casos antes de iniciar testes massivos.

**Cobertura mínima:**

```text
evento passado sem data explícita
evento com hoje, ontem e amanhã
data absoluta
papel genérico ignorado sem revisão
entidade ambígua que justifica esclarecimento
tarefa incompleta
ação externa incompleta
preciso fazer versus prometi fazer
mensagem com decisão e hipótese
entrada passiva originada de e-mail
```

**Critério de aceite:**  
Resultados revisados manualmente e principais falsos positivos documentados.

## BLG-0207 - Montar dataset de treinamento e regressão

**Prioridade:** P0  
**Status:** backlog

**Descrição:**  
Criar uma coleção versionada de entradas, resultados esperados e resultados obtidos.

**Estrutura mínima por cenário:**

```text
scenario_id
category
raw_content
source_channel
source_mode
received_at
timezone
expected_output
actual_output
extractor_version
review_status
notes
```

**Critério de aceite:**  
Dataset inicial com pelo menos 30 cenários diversos.

## BLG-0208 - Criar workflow de execução em lote

**Prioridade:** P0  
**Status:** backlog

**Descrição:**  
Executar automaticamente a bateria de casos e armazenar respostas para comparação.

**Critério de aceite:**  
É possível rodar todos os cenários contra uma versão do extrator e comparar resultados.

## BLG-0209 - Definir métricas de qualidade do extrator

**Prioridade:** P1  
**Status:** backlog

**Métricas iniciais:**

```text
taxa de JSON válido
taxa de eventos corretos
taxa de tarefas corretas
taxa de classificações epistemológicas corretas
falsos positivos de entidade
falsos negativos de entidade
falsos positivos de clarification_request
falsos negativos de clarification_request
uso indevido de requires_review
uso indevido de datas inferidas
```

## BLG-0210 - Congelar extractor-v1.1 após calibração

**Prioridade:** P0  
**Status:** backlog

**Critério de aceite:**  
Versão utilizada como baseline para persistência no Supabase.

---

# 6. Fase 1C: captura e persistência

## BLG-0301 - Criar webhook manual de captura

**Prioridade:** P1  
**Status:** backlog

## BLG-0302 - Salvar inbox_item antes da interpretação

**Prioridade:** P1  
**Status:** backlog

**Critério de aceite:**  
Toda entrada é preservada integralmente antes da chamada ao modelo.

## BLG-0303 - Executar Inbox Processor após captura

**Prioridade:** P1  
**Status:** backlog

## BLG-0304 - Persistir entities

**Prioridade:** P1  
**Status:** backlog

## BLG-0305 - Persistir events

**Prioridade:** P1  
**Status:** backlog

## BLG-0306 - Persistir event_entities

**Prioridade:** P1  
**Status:** backlog

## BLG-0307 - Persistir assertions

**Prioridade:** P1  
**Status:** backlog

## BLG-0308 - Persistir tasks

**Prioridade:** P1  
**Status:** backlog

## BLG-0309 - Retornar confirmação estruturada ao usuário

**Prioridade:** P1  
**Status:** backlog

**Critério de aceite:**  
Uma mensagem livre gera confirmação fiel do que foi registrado.

---

# 7. Fase 1D: correção e reprocessamento

## BLG-0401 - Permitir corrigir uma extração

**Prioridade:** P1  
**Status:** backlog

## BLG-0402 - Registrar histórico da correção

**Prioridade:** P1  
**Status:** backlog

## BLG-0403 - Permitir reprocessar inbox_item com nova versão do extrator

**Prioridade:** P1  
**Status:** backlog

## BLG-0404 - Priorizar versão vigente em consultas futuras

**Prioridade:** P1  
**Status:** backlog

---

# 8. Fase 1.5: pedidos de esclarecimento

## BLG-0501 - Validar qualidade das clarification_requests no extrator

**Prioridade:** P0  
**Status:** backlog

**Descrição:**  
Confirmar que o modelo identifica dúvidas úteis sem transformar qualquer lacuna em pergunta.

## BLG-0502 - Criar tabela clarification_requests

**Prioridade:** P1  
**Status:** backlog

**Campos iniciais sugeridos:**

```text
id
inbox_item_id
target_type
target_reference
issue_type
question
reason
priority
blocking_scope
suggested_answers
source_excerpt
status
answer
answered_at
created_at
```

## BLG-0503 - Criar Clarification Manager determinístico

**Prioridade:** P1  
**Status:** backlog

**Descrição:**  
Decidir o tratamento de cada pedido de esclarecimento conforme origem, prioridade e escopo de bloqueio.

**Regras iniciais:**

```text
origem conversacional + prioridade alta = perguntar imediatamente
origem conversacional + prioridade média = registrar e perguntar após confirmação
origem passiva = armazenar pendência sem responder ao remetente
blocking_scope external_action = impedir execução até resposta
blocking_scope task_execution = registrar tarefa, mas impedir execução
blocking_scope none = apenas armazenar pendência
```

## BLG-0504 - Criar experiência mínima de resolução

**Prioridade:** P1  
**Status:** backlog

**Descrição:**  
Permitir responder uma dúvida pendente e salvar a resposta.

## BLG-0505 - Criar briefing de pendências

**Prioridade:** P2  
**Status:** backlog

## BLG-0506 - Resolver ambiguidades automaticamente com memória confiável

**Prioridade:** P3  
**Status:** backlog

**Observação:**  
Não implementar antes da recuperação básica estar funcional.

---

# 9. Fase 2: recuperação básica

## BLG-0601 - Implementar buscar_contexto()

**Prioridade:** P1  
**Status:** backlog

## BLG-0602 - Implementar listar_tarefas()

**Prioridade:** P1  
**Status:** backlog

## BLG-0603 - Implementar listar_eventos_por_entidade()

**Prioridade:** P1  
**Status:** backlog

## BLG-0604 - Implementar listar_decisoes()

**Prioridade:** P1  
**Status:** backlog

## BLG-0605 - Limitar contexto recuperado

**Prioridade:** P1  
**Status:** backlog

---

# 10. Fase 3: busca semântica

## BLG-0701 - Adicionar pgvector

**Prioridade:** P2  
**Status:** backlog

## BLG-0702 - Gerar embeddings para textos relevantes

**Prioridade:** P2  
**Status:** backlog

## BLG-0703 - Criar busca híbrida

**Prioridade:** P2  
**Status:** backlog

---

# 11. Fase 4: briefing diário

## BLG-0801 - Definir conteúdo do briefing

**Prioridade:** P2  
**Status:** backlog

## BLG-0802 - Gerar resumo de agenda, tarefas e pendências

**Prioridade:** P2  
**Status:** backlog

---

# 12. Fase 5: ações assistidas

## BLG-0901 - Preparar rascunho de e-mail

**Prioridade:** P2  
**Status:** backlog

## BLG-0902 - Preparar criação de evento no calendário

**Prioridade:** P2  
**Status:** backlog

## BLG-0903 - Exigir aprovação humana para ações externas

**Prioridade:** P2  
**Status:** backlog

---

# 13. Fase 6: integrações adicionais

## BLG-1001 - Integrar e-mail como fonte passiva

**Prioridade:** P2  
**Status:** backlog

## BLG-1002 - Integrar calendário como fonte passiva

**Prioridade:** P2  
**Status:** backlog

## BLG-1003 - Integrar documentos

**Prioridade:** P2  
**Status:** backlog

## BLG-1004 - Integrar transcrições

**Prioridade:** P2  
**Status:** backlog

## BLG-1005 - Avaliar WhatsApp ou Telegram como canal conversacional

**Prioridade:** P2  
**Status:** backlog

---

# 14. Itens conscientemente adiados

Não implementar agora:

```text
múltiplos agentes especializados
LangGraph
MCP
banco de grafos dedicado
autonomia elevada
particionamento
materialized views
deduplicação totalmente automática
ontologia exaustiva
resolução automática sofisticada de ambiguidades
```

---

# 15. Próximo bloco de trabalho recomendado

Executar somente esta sequência:

```text
1. congelar extractor-v1
2. criar extractor-v1.1
3. adicionar regras incrementais ao prompt
4. adicionar clarification_requests ao schema
5. incluir source_channel e source_mode no input
6. reexecutar o primeiro cenário
7. executar bateria curta direcionada
8. revisar falsos positivos e falsos negativos
9. ajustar extractor-v1.1
10. congelar versão antes de persistir em produção
```


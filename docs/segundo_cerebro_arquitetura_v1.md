# Segundo Cérebro Pessoal com Agentes de IA
## Documento Canônico de Arquitetura v1

**Status:** Baseline arquitetural aprovada para início do MVP  
**Versão:** 1.0  
**Data:** 30/05/2026  
**Objetivo do documento:** centralizar princípios, decisões arquiteturais, escopo inicial, limites e próximos passos do projeto.  
**Uso recomendado:** fonte principal do projeto no ChatGPT e referência para novas decisões técnicas.

---

# 1. Resumo executivo

O projeto tem como objetivo construir um assistente pessoal com IA capaz de funcionar como um segundo cérebro: registrar informações, recuperar contexto relevante, organizar tarefas, preservar decisões e, futuramente, propor ou executar ações controladas.

A arquitetura não deve ser baseada em um prompt gigante nem em vários agentes especializados desde o início. O núcleo será um sistema de contexto confiável, auditável e progressivamente extensível.

A premissa central é:

> Todo conteúdo relevante é capturado sem alteração.  
> Fatos relevantes são promovidos a eventos.  
> Eventos são relacionados a entidades.  
> Afirmações são separadas entre fato, hipótese, opinião, decisão e compromisso.  
> Políticas orientam e limitam o comportamento do agente.  
> Ações externas passam por validação e, inicialmente, por aprovação humana.

O MVP deve ser pequeno, utilizável e observável. Complexidade adicional será incorporada apenas quando um problema real justificar.

---

# 2. Problema que o sistema resolve

Informações pessoais e profissionais ficam dispersas em conversas, mensagens, áudios, reuniões, documentos e tarefas. Mesmo quando uma informação foi registrada, frequentemente é difícil recuperar:

- o que aconteceu;
- quem participou;
- qual decisão foi tomada;
- quais hipóteses ainda não foram confirmadas;
- quais compromissos continuam abertos;
- qual regra deve orientar determinada ação;
- qual é a fonte original de uma afirmação;
- qual informação substituiu uma decisão anterior.

O sistema deve converter registros dispersos em memória pesquisável, sem apagar a origem e sem confundir interpretação com fato.

---

# 3. Princípios arquiteturais

## 3.1. Preservar o original

A entrada original deve ser salva antes de qualquer interpretação. O sistema nunca sobrescreve silenciosamente a fonte recebida.

Exemplos de entrada:

- texto enviado manualmente;
- transcrição de áudio;
- mensagem importada;
- e-mail;
- documento;
- evento de calendário.

## 3.2. Separar observação, interpretação e ação

O sistema deve distinguir três mundos:

### Mundo observado
Registra o que foi capturado ou ocorreu.

- fontes;
- eventos;
- entidades;
- documentos.

### Mundo interpretado
Representa o significado atribuído ao conteúdo.

- afirmações;
- fatos;
- hipóteses;
- decisões;
- opiniões;
- compromissos;
- relações.

### Mundo normativo
Define o que o agente deve fazer ou pode executar.

- políticas;
- guardrails;
- permissões;
- tarefas;
- ações;
- aprovações.

## 3.3. Usar eventos como trilha histórica, não como única forma de consulta

Eventos preservam o histórico. Tabelas de projeção representam o estado atual.

Exemplo:

```text
events:
- tarefa criada
- tarefa adiada
- tarefa concluída

tasks:
- estado atual da tarefa
```

## 3.4. Não tratar hipótese como fato

Uma mesma mensagem pode gerar diferentes tipos de afirmação.

Exemplo:

```text
Entrada:
“O fornecedor ainda não liberou o IP. Acho que isso pode atrasar a integração.”

Fato alegado:
“O fornecedor ainda não liberou o IP.”

Hipótese:
“A integração pode atrasar.”
```

## 3.5. Contexto suficiente, não contexto máximo

O agente não deve receber o banco inteiro. Antes de responder, o sistema deve selecionar somente o contexto relevante para a tarefa atual.

## 3.6. O prompt orienta, o código valida e as permissões limitam

Regras críticas não podem depender somente da interpretação do modelo.

Exemplo:

```text
Diretriz em prompt:
“Não envie e-mails sem aprovação.”

Validação técnica:
A ferramenta send_email exige aprovação humana.

Permissão:
O agente não possui acesso direto a operações proibidas.
```

## 3.7. Complexidade progressiva

O desenho conceitual pode ser rico. A implementação inicial deve ser simples.

---

# 4. Lentes filosóficas utilizadas

A arquitetura foi revisada a partir de conceitos filosóficos e cognitivos para evitar erros conceituais.

## 4.1. Ontologia: o que existe no sistema?

O sistema precisa representar tipos diferentes de objetos:

| Objeto | Pergunta respondida |
|---|---|
| Entidade | Quem ou o que existe? |
| Evento | O que aconteceu? |
| Afirmação | O que está sendo afirmado? |
| Relação | Como objetos se conectam? |
| Fonte | De onde veio a informação? |
| Política | Como o agente deve agir? |
| Tarefa | O que precisa ser feito? |
| Ação | O que foi proposto ou executado? |
| Objetivo | Para que determinada ação existe? |

## 4.2. Epistemologia: o que o sistema sabe?

Toda afirmação relevante deve possuir:

- conteúdo;
- fonte;
- tipo;
- confiança;
- status;
- validade temporal;
- possibilidade de correção.

## 4.3. Filosofia da linguagem: o que uma fala está fazendo?

Uma frase não possui apenas conteúdo. Ela também pode exercer uma função:

- afirmar;
- perguntar;
- pedir;
- prometer;
- sugerir;
- decidir;
- instruir.

Exemplo:

```text
“Eu envio o contrato amanhã.”
```

Pode representar uma intenção, uma promessa ou uma tarefa.

## 4.4. Hermenêutica: significado depende de contexto

Mensagens curtas podem ser ambíguas:

```text
“Pode seguir.”
```

O significado depende da conversa, da ação pendente e das políticas aplicáveis.

## 4.5. Razão prática: pensar não é executar

O sistema deve respeitar a sequência:

```text
observar
→ interpretar
→ propor
→ aprovar
→ executar
→ registrar
```

## 4.6. Racionalidade limitada

O banco pode crescer. O modelo continua funcional desde que receba apenas o contexto necessário.

## 4.7. Pragmatismo

O valor do segundo cérebro não será medido pela quantidade de registros armazenados, mas pela melhoria prática nas decisões e na execução.

---

# 5. Arquitetura conceitual

```text
Canais de entrada
WhatsApp | Telegram | formulário | áudio | e-mail | calendário
                         ↓
                 Capture Gateway
      salva sempre o conteúdo bruto recebido
                         ↓
                 Inbox Processor
      classifica, interpreta e extrai estrutura
                         ↓
        ┌────────────────┴────────────────┐
        ↓                                 ↓
    Event Store                     Entity Registry
 histórico imutável            pessoas, empresas, projetos
        ↓                                 ↓
        └────────────────┬────────────────┘
                         ↓
                  Knowledge Layer
       afirmações, hipóteses, decisões e compromissos
                         ↓
                  Projection Layer
          tarefas e estados atuais consultáveis
                         ↓
                  Policy Resolver
      seleciona regras aplicáveis ao contexto atual
                         ↓
                   Context Builder
      recupera somente informações necessárias
                         ↓
                    Agent Runtime
          interpreta, redige ou propõe ações
                         ↓
                   Action Gateway
      valida permissões e exige aprovação humana
                         ↓
             calendário | e-mail | tarefas

Camadas transversais:
auditoria | tracing | segurança | métricas | backups | avaliações
```

---

# 6. Componentes

## 6.1. Capture Gateway

Responsável por receber e preservar conteúdo bruto.

Responsabilidades:

- receber entrada;
- gerar chave de idempotência;
- salvar origem;
- registrar data de recebimento;
- preservar texto original;
- permitir reprocessamento.

## 6.2. Inbox Processor

Responsável por interpretar o conteúdo capturado.

Extrai:

- eventos;
- entidades;
- afirmações;
- tarefas;
- confiança;
- necessidade de revisão.

## 6.3. Event Store

Responsável pelo histórico append-only.

Exemplos:

```text
meeting_registered
decision_made
task_created
task_completed
commitment_created
document_registered
policy_updated
event_corrected
event_invalidated
```

## 6.4. Entity Registry

Responsável pelo cadastro de objetos relevantes.

Tipos iniciais:

```text
person
company
project
product
topic
document
location
other
```

Exemplos:

```text
Bruno Brant
VELT
Tagna
OMIE
Integração OMIE Tagna
Genius Hotels
```

## 6.5. Knowledge Layer

Responsável por representar o significado extraído dos eventos.

Tipos iniciais de afirmação:

```text
fact
hypothesis
opinion
decision
commitment
question
assumption
recommendation
```

Status iniciais:

```text
unverified
supported
confirmed
contested
invalidated
superseded
```

## 6.6. Projection Layer

Responsável pelo estado atual.

Primeira projeção:

```text
tasks
```

Possíveis projeções futuras:

```text
projects
active_policies
open_commitments
entity_profiles
daily_summaries
```

## 6.7. Policy Resolver

Responsável por selecionar regras aplicáveis antes de cada tarefa.

Entrada esperada:

```text
operation
channel
project
entities
domain
risk_level
tool
communication_scope
data_sensitivity
```

Saída:

```text
políticas vigentes e relevantes, ordenadas por precedência e prioridade
```

## 6.8. Context Builder

Responsável por recuperar contexto suficiente.

Combina:

- entidades citadas;
- eventos recentes;
- tarefas abertas;
- decisões vigentes;
- afirmações relevantes;
- políticas aplicáveis;
- filtros por data;
- busca textual;
- busca semântica em fase posterior;
- limite de tokens.

## 6.9. Agent Runtime

Responsável por interpretar, resumir, comparar, redigir e sugerir.

O modelo não deve ser usado para substituir consultas determinísticas simples.

## 6.10. Action Gateway

Responsável por controlar ações externas.

Níveis de autonomia:

| Nível | Significado |
|---|---|
| read | consultar dados |
| suggest | sugerir ação |
| draft | preparar rascunho |
| execute_with_approval | executar somente após aprovação |
| execute_automatically | executar sem aprovação |
| forbidden | operação proibida |

---

# 7. Modelo de dados do MVP

## 7.1. Tabelas implementadas inicialmente

```text
inbox_items
events
entities
event_entities
assertions
tasks
policies
```

## 7.2. Tabelas planejadas para fase posterior

```text
sources
assertion_evidence
entity_relationships
projects
goals
actions
documents
agent_runs
tool_runs
retrieval_logs
human_reviews
policy_categories
policy_operations
policy_scopes
```

## 7.3. Motivo da simplificação

A arquitetura reconhece conceitos futuros, mas o MVP não deve implementar tudo antecipadamente.

O objetivo inicial é validar:

- captura;
- interpretação;
- persistência;
- recuperação;
- correção;
- utilidade cotidiana.

---

# 8. Fluxo principal do MVP

```text
Usuário envia texto
        ↓
Salvar conteúdo bruto em inbox_items
        ↓
Carregar políticas básicas de registro
        ↓
Extrair eventos, entidades, afirmações e tarefas
        ↓
Validar estrutura
        ↓
Salvar dados
        ↓
Responder mostrando o que foi registrado
```

Exemplo:

```text
Entrada:
“Conversei com o Bruno sobre a integração da Genius.
Acho que a liberação do IP pode atrasar.
Preciso cobrar o fornecedor amanhã.”

Saída esperada:
Evento:
Conversa com Bruno sobre integração da Genius.

Entidades:
Bruno, Genius, Integração Genius.

Hipótese:
A liberação do IP pode atrasar.

Tarefa:
Cobrar o fornecedor amanhã.
```

---

# 9. Políticas e guardrails

## 9.1. Diferença conceitual

| Tipo | Papel |
|---|---|
| Preferência | melhora estilo ou experiência |
| Diretriz | orienta elaboração e interpretação |
| Regra operacional | define uma obrigação verificável |
| Guardrail | bloqueia ou condiciona comportamento |
| Permissão técnica | limita capacidade real do sistema |

## 9.2. Campos mínimos de uma política

```text
code
name
description
category
operation
scope_type
scope_id
enforcement_stage
enforcement_mode
content
priority
status
metadata
```

## 9.3. Categorias iniciais

```text
reasoning
retrieval
context
writing
email
calendar
task
privacy
security
memory
execution
```

## 9.4. Operações iniciais

```text
all
register_event
search_memory
answer_question
summarize
write_email
send_email
write_message
create_calendar_event
update_calendar_event
```

## 9.5. Estágios de aplicação

```text
before_retrieval
before_generation
after_generation
before_tool_call
after_tool_call
```

## 9.6. Modos de aplicação

```text
prompt_instruction
workflow_validation
human_review
hard_block
logging_only
```

## 9.7. Precedência inicial

```text
hard_block
↓
privacy_security
↓
tool
↓
entity
↓
project
↓
operation
↓
channel
↓
agent
↓
global
```

Dentro do mesmo nível, utilizar prioridade numérica.

## 9.8. Regras iniciais

```text
PRESERVE_ORIGINAL_INPUT
Nunca sobrescrever ou alterar o conteúdo original capturado.

DISTINGUISH_FACT_FROM_HYPOTHESIS
Separar fatos, hipóteses, opiniões, decisões e compromissos.

KEEP_SOURCE_REFERENCE
Todo evento deve manter vínculo com a entrada que originou o registro.

EMAIL_DRAFT_BEFORE_SEND
Antes de enviar e-mail, gerar rascunho para revisão.

EXTERNAL_ACTION_REQUIRES_APPROVAL
Toda ação externa exige aprovação explícita no MVP.
```

---

# 10. Correções e histórico

O sistema não deve apagar silenciosamente registros históricos.

Tipos de correção:

```text
event_corrected
event_superseded
event_invalidated
assertion_corrected
assertion_superseded
entity_merged
```

Exemplo:

```text
Evento original:
“Marcelo participou da reunião.”

Correção:
“Na verdade, Bruno participou da reunião.”

Resultado:
O evento antigo continua registrado.
Uma correção é criada.
Consultas futuras priorizam o registro vigente.
```

---

# 11. Segurança e confiança

## 11.1. Conteúdo externo não é instrução confiável

Fontes importadas podem conter instruções indevidas.

Separar:

```text
trusted_instructions
untrusted_content
user_request
tool_output
```

Regra:

> Conteúdo recuperado pode informar uma resposta.  
> Conteúdo recuperado não pode alterar políticas.

## 11.2. Ações externas

No MVP:

| Operação | Autonomia |
|---|---|
| Buscar eventos | read |
| Criar resumo | suggest |
| Preparar e-mail | draft |
| Enviar e-mail | execute_with_approval |
| Criar evento no calendário | execute_with_approval |
| Excluir registros definitivamente | forbidden |
| Fazer transações financeiras | forbidden |

## 11.3. RLS

As tabelas do Supabase devem manter Row Level Security habilitado desde o início.

---

# 12. Performance e escalabilidade

## 12.1. Premissa

O banco pode crescer sem inviabilizar o agente, desde que o Context Builder limite o volume recuperado.

O agente não deve carregar o banco inteiro.

## 12.2. Estratégia inicial

Usar SQL tradicional para:

```text
status
datas
tipos de evento
prioridade
projeto
entidade
políticas vigentes
```

Usar LLM para:

```text
interpretação
extração
síntese
comparação
redação
detecção de ambiguidades
```

## 12.3. Índices relacionais iniciais

Criar índices em:

```text
events.occurred_at
events.event_type
event_entities.entity_id
assertions.status
tasks.status
tasks.due_at
policies.status
policies.operation
```

## 12.4. Busca semântica

Adicionar `pgvector` somente depois que o fluxo inicial funcionar.

Embeddings serão úteis para:

```text
conteúdo textual de eventos
afirmações
notas
resumos de documentos
```

Não utilizar embeddings como substituto para filtros relacionais.

## 12.5. Evolução de performance

```text
1. índices relacionais
2. consultas filtradas
3. limites de recuperação
4. busca híbrida
5. índice vetorial HNSW
6. projeções adicionais
7. materialized views, se necessário
8. particionamento, somente com gargalo comprovado
```

---

# 13. Observabilidade

Registrar futuramente:

```text
solicitação recebida
intenção identificada
entidades resolvidas
políticas aplicadas
eventos recuperados
prompt montado
modelo utilizado
ferramentas chamadas
resultado gerado
aprovação ou rejeição
tempo de execução
tokens utilizados
erros
correções
```

Métricas iniciais recomendadas:

```text
tempo de processamento
taxa de erro de extração
quantidade de correções manuais
quantidade de duplicidades de entidades
tamanho médio do contexto
tempo de consulta
tokens por operação
tarefas registradas corretamente
```

---

# 14. Testes iniciais

## 14.1. Cenários mínimos

1. Registrar reunião simples.
2. Registrar decisão e tarefa na mesma mensagem.
3. Diferenciar fato e hipótese.
4. Corrigir informação anterior.
5. Identificar entidade existente.
6. Sugerir possível duplicidade de entidade.
7. Buscar eventos relacionados a uma empresa.
8. Listar tarefas abertas.
9. Carregar políticas aplicáveis para escrever e-mail.
10. Bloquear envio sem aprovação.

## 14.2. Exemplo de teste

```text
Entrada:
“Conversei com o Bruno sobre a Genius.
Talvez a liberação atrase.
Vou cobrar amanhã.”

Resultado esperado:
- 1 evento de conversa;
- 1 hipótese;
- 1 tarefa;
- entidades relacionadas;
- nenhuma afirmação de atraso confirmado.
```

---

# 15. Roadmap

## Fase 1: captura e persistência

Objetivo:

```text
Salvar entrada bruta.
Extrair estrutura.
Exibir confirmação.
Permitir correção.
```

Entregas:

```text
schema inicial
webhook de captura
workflow N8N
prompt de extração estruturada
persistência
resposta de confirmação
```

## Fase 2: recuperação básica

Objetivo:

```text
Consultar memória por entidade, tipo e período.
```

Entregas:

```text
buscar_contexto()
listar_tarefas()
listar_eventos_por_entidade()
listar_decisoes()
```

## Fase 3: busca semântica

Objetivo:

```text
Encontrar contexto relacionado mesmo sem correspondência literal.
```

Entregas:

```text
pgvector
embeddings
busca híbrida
índice vetorial quando necessário
```

## Fase 4: briefing diário

Objetivo:

```text
Gerar resumo útil de agenda, tarefas, pendências e projetos parados.
```

## Fase 5: ações assistidas

Objetivo:

```text
Preparar rascunhos e propor ações externas.
```

Ações inicialmente condicionadas a aprovação.

## Fase 6: integrações adicionais

Possíveis fontes:

```text
e-mail
calendário
documentos
transcrições
WhatsApp
```

---

# 16. Decisões conscientemente adiadas

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
integração com todos os canais
```

Motivo:

> A complexidade só deve ser adicionada quando um problema real justificar.

---

# 17. ADRs iniciais

## ADR-001: utilizar um ledger central de eventos

**Status:** aceito  
**Decisão:** registrar fatos relevantes em uma tabela central `events`.  
**Motivo:** preservar histórico e permitir reconstrução contextual.  
**Limite:** eventos não substituem projeções de estado atual.

## ADR-002: preservar entrada bruta antes da interpretação

**Status:** aceito  
**Decisão:** salvar toda entrada em `inbox_items` antes de qualquer processamento.  
**Motivo:** permitir auditoria, correção e reprocessamento.

## ADR-003: utilizar catálogo genérico de entidades

**Status:** aceito  
**Decisão:** utilizar `entities` com tipos como pessoa, empresa e projeto.  
**Motivo:** simplificar indexação e evolução inicial.

## ADR-004: representar afirmações separadamente

**Status:** aceito  
**Decisão:** utilizar `assertions` para distinguir fato, hipótese, decisão, opinião e compromisso.  
**Motivo:** evitar tratar toda informação extraída como verdade equivalente.

## ADR-005: manter políticas como dados configuráveis

**Status:** aceito  
**Decisão:** criar tabela `policies` com categoria, operação, escopo, estágio e modo de aplicação.  
**Motivo:** permitir regras contextuais sem prompt monolítico.

## ADR-006: adotar Policy Resolver

**Status:** aceito  
**Decisão:** selecionar políticas aplicáveis antes de cada operação.  
**Motivo:** carregar somente regras relevantes e controlar conflitos.

## ADR-007: limitar autonomia no MVP

**Status:** aceito  
**Decisão:** permitir leitura, sugestão e rascunhos. Ações externas exigem aprovação.  
**Motivo:** reduzir risco enquanto a confiabilidade ainda está sendo validada.

## ADR-008: adiar busca vetorial

**Status:** aceito  
**Decisão:** iniciar com filtros relacionais e adicionar embeddings posteriormente.  
**Motivo:** validar primeiro captura e modelagem.

## ADR-009: priorizar simplicidade operacional

**Status:** aceito  
**Decisão:** iniciar com Supabase e N8N, sem múltiplos agentes ou orquestração avançada.  
**Motivo:** reduzir complexidade antecipada.

---

# 18. Template para futuros ADRs

```text
# ADR-XXX: título

Status:
proposto | aceito | substituído | rejeitado

Contexto:
qual problema motivou a decisão?

Decisão:
o que foi decidido?

Alternativas consideradas:
quais caminhos foram avaliados?

Consequências:
quais benefícios e limitações surgem?

Data:
DD/MM/AAAA
```

---

# 19. Fonte de verdade e governança do projeto

Este documento deve ser a referência canônica inicial do projeto.

Regra de governança:

```text
Mudanças pequenas:
atualizar este documento.

Decisões arquiteturais relevantes:
criar ADR.

Mudanças implementadas no banco:
criar migration versionada.

Hipóteses ainda não aprovadas:
registrar em seção separada de pontos em aberto.
```

Estrutura recomendada de arquivos:

```text
/docs
  architecture.md
  /adr
    ADR-001-event-ledger.md
    ADR-002-raw-input.md
    ...
/supabase
  /migrations
    001_core.sql
```

---

# 20. Pontos em aberto

Decisões ainda não fechadas:

```text
canal inicial de captura: webhook manual, WhatsApp ou Telegram
modelo utilizado para extração
formato exato do JSON estruturado
estratégia de deduplicação de entidades
necessidade de tabela sources já na fase 1
forma de revisão manual
interface inicial de consulta
momento de introdução de pgvector
```

---

# 21. Próximo passo imediato

Executar a migration inicial no Supabase.

Depois, implementar um workflow mínimo:

```text
Webhook manual
      ↓
Salvar inbox_item
      ↓
Executar extração estruturada
      ↓
Salvar entities
      ↓
Salvar events
      ↓
Salvar assertions
      ↓
Salvar tasks
      ↓
Retornar confirmação
```

Critério de conclusão:

> Enviar uma mensagem livre e receber uma confirmação fiel, estruturada e corrigível do que foi registrado.

---

# 22. Regra final

> Construir um núcleo pequeno, instrumentado e extensível.  
> Usar diariamente.  
> Observar erros reais.  
> Adicionar complexidade somente quando um problema concreto justificar.

---

# 23. Suplemento MVP — aliases e bootstrap (2026-05-31)

Decisões implementadas no código (detalhes em `docs/decisoes-arquiteturais.md`):

- **Aliases:** `entity_aliases` é a única fonte persistida; REST/MCP calculam aliases por join.
- **Bootstrap:** `source_channel = bootstrap` dispara linking amplo no evento principal escolhido deterministicamente (não depende só de `document_snapshot`).
- **Cotidiano:** mensagens com outros canais mantêm linking contextual por evento.
- **Assertions:** sem teto artificial de 15; omissões vêm do modelo; revisão manual via `bootstrap_assertion_completeness_review`.

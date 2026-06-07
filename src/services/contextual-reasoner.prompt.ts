import type { ReasonInput } from './contextual-reasoner.types.js';

/**
 * Versões e constantes do Reasoner.
 * Bump PROMPT_VERSION quando few-shots ou regras mudarem.
 */
export const REASONER_VERSION = 'contextual-reasoner-v1.0';
export const REASONER_PROMPT_VERSION = 'contextual-reasoner-v1.0.0';
export const REASONER_SCHEMA_VERSION = '1.0';

/**
 * System prompt do Contextual Reasoner.
 *
 * MISSÃO: Decidir, dado o contexto completo (msg atual + clarifs pendentes +
 * thread + tasks ativas), o que o usuário está REALMENTE tentando fazer.
 *
 * Decisões possíveis:
 * - pure_reply: msg responde clarif(ns) pendente(s), sem conteúdo novo
 * - new_capture: conteúdo novo, sem relação com clarifs/tasks
 * - mixed: responde clarif(ns) E adiciona conteúdo novo
 * - update_existing: msg atualiza uma task existente (mudou prazo, responsável, status, etc)
 * - cancel_pending: usuário desiste de uma task
 * - unrelated: msg não tem relação com nada (ex: "oi")
 */
export const REASONER_SYSTEM_PROMPT = `Você é o Contextual Reasoner de um Segundo Cérebro pessoal (PT-BR). Recebe o contexto COMPLETO de uma conversa e decide o que o usuário está tentando fazer.

## MISSÃO

Analisar:
- MENSAGEM ATUAL do usuário
- CLARIFICAÇÕES PENDENTES (perguntas esperando resposta)
- THREAD CONTEXT (últimas mensagens do mesmo thread)
- TASKS ATIVAS (tasks recentes, com prazo, responsável, projeto)

E devolver um JSON estruturado com:
1. decision.kind — o que o usuário quer fazer
2. clarif_resolutions — quais clarifs pendentes a msg atual responde
3. task_updates — quais tasks ativas estão sendo atualizadas
4. new_capture — conteúdo novo a ser extraído (se houver)
5. new_clarifications — SÓ para gaps GENUINAMENTE desconhecidos (nada já respondido no contexto)

## DECISÕES POSSÍVEIS

- **pure_reply** — msg responde clarif(ns) pendente(s), sem conteúdo novo substancial
- **new_capture** — conteúdo novo, sem relação com clarifs/tasks ativas
- **mixed** — responde clarif(ns) E adiciona conteúdo novo (mais comum)
- **update_existing** — msg atualiza uma task existente (mudou prazo, responsável, status)
- **cancel_pending** — usuário desiste de uma task ativa ("esquece", "desisti", "cancela")
- **unrelated** — msg não tem relação com nada (ex: "oi", "tudo bem?")

## REGRAS DURAS

1. Se a msg atual responde QUALQUER clarif pendente (mesmo que parcialmente):
   - decision.kind DEVE ser no mínimo "mixed" (NUNCA "new_capture" puro)
   - Adicione a resolução em clarif_resolutions com answered=true

2. Se a msg menciona prazo/data E existe task ativa SEM due_at (ou com due_at diferente):
   - Considere update_existing OU mixed (com task_updates)
   - Se a task nova é sub-tarefa de uma task pai que TEM due_at:
     - Use task_updates com inherit_from_parent=true
     - NÃO crie clarif de prazo (o pai já tem)

3. new_clarifications SÓ para gaps que o contexto (thread + tasks + clarifs) NÃO cobre:
   - NUNCA pergunte algo que já foi dito na thread
   - NUNCA pergunte algo que uma task pai já capturou
   - NUNCA pergunte algo que o user já respondeu indiretamente

4. Se a msg é "unrelated" (oi, ok, etc):
   - decision.kind = "unrelated"
   - new_capture = null
   - new_clarifications = []
   - task_updates = []

5. task_id em task_updates DEVE ser um ID real presente em activeTasks. Se você não tem certeza, NÃO inclua task_updates.

6. Em mixed: o new_capture.effective_input DEVE ser a msg original + contexto relevante das clarifs/tasks resolvidas, formando um texto coeso para o extractor v14.

## POUCOS-SHOT (canônicos do domínio Wellerson)

### Few-shot 1: sub-task herda prazo do pai (J1)

Input:
- currentMessage: "Eu mesmo vou corrigir, são melhorias no âmbito de produto. Que terei que codar."
- pendingClarifications: [{ id: "clf_1", question: "Quem será o responsável por corrigir os pontos do projeto Miranda?", target_reference: "responsável", suggested_answers: ["Eu (você)", "Cátia", "Outra pessoa"], inbox_item_id: "inb_1" }]
- threadContext.recentMessages: [{ inbox_item_id: "inb_0", raw_content: "Websummit começa amanhã, dia 08 de junho e termina dia 11... Sobre corrigir os pontos do projeto Miranda, pretendo acabar hoje mesmo.", created_at: "2026-06-07T10:54:00Z" }]
- activeTasks: [{ id: "task_abc", title: "Corrigir os pontos do projeto Miranda", status: "open", due_at: "2026-06-07", assignee_reference: null, project_reference: "Miranda", inbox_item_id: "inb_0", created_at: "2026-06-07T10:54:00Z" }]

Output esperado:
{
  "decision": { "kind": "mixed", "confidence": 0.95, "reasoning": "Responde clarif 'Quem' + atualiza task pai com responsável Wellerson." },
  "clarif_resolutions": [{ "clarification_id": "clf_1", "answered": true, "answer": "Eu mesmo (Wellerson)", "confidence": 0.97 }],
  "task_updates": [{ "task_id": "task_abc", "operation": "update_assignee", "new_value": "Wellerson", "inherit_from_parent": false, "parent_task_id": null, "reasoning": "User disse 'Eu mesmo vou corrigir'." }],
  "new_capture": { "effective_input": "Atualização: Eu mesmo vou corrigir os pontos do projeto Miranda. As correções são melhorias no âmbito de produto que terei que codar.", "summary": "Atualiza task pai com responsável + detalha tipo de correção (melhorias de produto)." },
  "new_clarifications": []
}

### Few-shot 2: responde 2 clarifs de uma vez (J3)

Input:
- currentMessage: "Websummit começa amanhã, dia 08 de junho e termina dia 11. Inclusive enviarei muitas coisas relacionadas ao websummit para que você registre. Mas só voltarei do Rio dia 14. A lari chega no rio dia 12 e estaremos juntos até dia 14 quando voltaremos a BH. Sobre corrigir os pontos do projeto Miranda, pretendo acabar hoje mesmo."
- pendingClarifications: [
    { id: "clf_1", question: "Qual a data de 'Estar no Rio pela Websummit'?", target_reference: "Estar no Rio pela Websummit", inbox_item_id: "inb_0" },
    { id: "clf_2", question: "Para 'Corrigir os pontos do projeto Miranda': qual o prazo?", target_reference: "Corrigir os pontos do projeto Miranda", inbox_item_id: "inb_0" }
  ]
- threadContext.recentMessages: [{ inbox_item_id: "inb_-1", raw_content: "Ok. Preciso lembrar de corrigir os pontos levantados pela Cátia com relação ao projeto Miranda...", created_at: "2026-06-07T10:51:00Z" }]
- activeTasks: [{ id: "task_abc", title: "Corrigir os pontos do projeto Miranda", status: "open", due_at: null, assignee_reference: null, project_reference: "Miranda", inbox_item_id: "inb_-1", created_at: "2026-06-07T10:51:00Z" }]

Output esperado:
{
  "decision": { "kind": "mixed", "confidence": 0.93, "reasoning": "Responde 2 clarifs (datas Websummit + prazo Miranda) + adiciona contexto de viagem (Rio, Lari, BH)." },
  "clarif_resolutions": [
    { "clarification_id": "clf_1", "answered": true, "answer": "08-06 a 11-06 (Websummit)", "confidence": 0.95 },
    { "clarification_id": "clf_2", "answered": true, "answer": "hoje mesmo (2026-06-07)", "confidence": 0.95 }
  ],
  "task_updates": [{ "task_id": "task_abc", "operation": "update_due_date", "new_value": "hoje mesmo (2026-06-07)", "inherit_from_parent": false, "parent_task_id": null, "reasoning": "User disse 'pretendo acabar hoje mesmo'." }],
  "new_capture": { "effective_input": "Websummit: começa amanhã (08-06) e termina 11-06. Voltarei do Rio dia 14. A Lari chega no Rio dia 12 e voltaremos juntos a BH dia 14. Sobre corrigir os pontos do projeto Miranda, pretendo acabar hoje mesmo.", "summary": "Resolve 2 pendentes + adiciona contexto Websummit (datas, viagem, Lari)." },
  "new_clarifications": []
}

### Few-shot 3: pure new capture (sem clarifs/tasks)

Input:
- currentMessage: "ideia: app de pomodoro com integração ao notion"
- pendingClarifications: []
- threadContext.recentMessages: []
- activeTasks: []

Output esperado:
{
  "decision": { "kind": "new_capture", "confidence": 0.99, "reasoning": "Sem clarifs pendentes; conteúdo novo e não relacionado a tasks ativas." },
  "clarif_resolutions": [],
  "task_updates": [],
  "new_capture": { "effective_input": "ideia: app de pomodoro com integração ao notion", "summary": "Ideia nova: app pomodoro + Notion." },
  "new_clarifications": []
}

### Few-shot 4: cancel

Input:
- currentMessage: "esquece, desisti do app de pomodoro"
- pendingClarifications: []
- threadContext.recentMessages: []
- activeTasks: [{ id: "task_xyz", title: "App de pomodoro com Notion", status: "open", due_at: null, inbox_item_id: "inb_old", created_at: "2026-06-01T10:00:00Z" }]

Output esperado:
{
  "decision": { "kind": "cancel_pending", "confidence": 0.9, "reasoning": "User cancelou task ativa 'App de pomodoro com Notion'." },
  "clarif_resolutions": [],
  "task_updates": [{ "task_id": "task_xyz", "operation": "cancel", "new_value": null, "inherit_from_parent": false, "parent_task_id": null, "reasoning": "User disse 'desisti'." }],
  "new_capture": null,
  "new_clarifications": []
}

### Few-shot 5: unrelated (small talk)

Input:
- currentMessage: "oi"
- pendingClarifications: []
- threadContext.recentMessages: []
- activeTasks: []

Output esperado:
{
  "decision": { "kind": "unrelated", "confidence": 0.98, "reasoning": "Saudação sem conteúdo substantivo." },
  "clarif_resolutions": [],
  "task_updates": [],
  "new_capture": null,
  "new_clarifications": []
}

## FORMATO DE RESPOSTA

Responda APENAS JSON válido no schema abaixo. Sem markdown, sem preâmbulo, sem comentários.

{
  "decision": {
    "kind": "pure_reply | new_capture | mixed | update_existing | cancel_pending | unrelated",
    "confidence": <0-1>,
    "reasoning": "<1-2 frases explicando>"
  },
  "clarif_resolutions": [
    { "clarification_id": "<id>", "answered": <bool>, "answer": "<string|null>", "confidence": <0-1> }
  ],
  "task_updates": [
    { "task_id": "<uuid>", "operation": "update_due_date | update_assignee | update_status | complete | cancel", "new_value": "<string|null>", "inherit_from_parent": <bool>, "parent_task_id": "<uuid|null>", "reasoning": "<string>" }
  ],
  "new_capture": { "effective_input": "<string>", "summary": "<string>" } | null,
  "new_clarifications": [
    { "question": "<string>", "target_reference": "<string>", "issue_type": "<string>", "suggested_answers": [...], "priority": <0-100>, "reasoning": "<string>" }
  ]
}`;

/**
 * Constrói a mensagem user com o contexto completo.
 */
export function buildReasonerUserMessage(input: ReasonInput): string {
  const lines: string[] = [];

  lines.push(`MENSAGEM ATUAL (${input.channel}, recebida ${input.receivedAt}, tz=${input.timezone}):`);
  lines.push(input.currentMessage);
  lines.push('');

  if (input.pendingClarifications.length > 0) {
    lines.push(`CLARIFICAÇÕES PENDENTES (${input.pendingClarifications.length}):`);
    for (const clf of input.pendingClarifications) {
      lines.push(`- [${clf.id}] Pergunta: "${clf.question}"`);
      lines.push(`  target: "${clf.target_reference}" | issue_type: ${clf.issue_type} | inbox: ${clf.inbox_item_id}`);
      if (clf.suggested_answers.length > 0) {
        lines.push(`  opções sugeridas: ${clf.suggested_answers.map((a) => `"${a}"`).join(', ')}`);
      }
      if (clf.source_excerpt) {
        lines.push(`  source: "${clf.source_excerpt.slice(0, 200)}"`);
      }
    }
    lines.push('');
  } else {
    lines.push('CLARIFICAÇÕES PENDENTES: nenhuma');
    lines.push('');
  }

  lines.push(`THREAD CONTEXT (thread_id: ${input.threadContext.thread_id}):`);
  if (input.threadContext.recentMessages.length > 0) {
    for (const msg of input.threadContext.recentMessages) {
      lines.push(`- [${msg.created_at}] (${msg.inbox_item_id}) ${msg.raw_content.slice(0, 500)}`);
    }
  } else {
    lines.push('(sem mensagens anteriores no thread)');
  }
  if (input.threadContext.salientEntities.length > 0) {
    lines.push('Entidades salientes:');
    for (const ent of input.threadContext.salientEntities) {
      lines.push(`- ${ent.reference} (${ent.entityType ?? '?'})${ent.canonicalName ? ` → ${ent.canonicalName}` : ''}`);
    }
  }
  lines.push('');

  if (input.activeTasks.length > 0) {
    lines.push(`TASKS ATIVAS (${input.activeTasks.length}):`);
    for (const t of input.activeTasks) {
      const due = t.due_at ? `prazo=${t.due_at}` : 'sem prazo';
      const resp = t.assignee_reference ? `responsável=${t.assignee_reference}` : 'sem responsável';
      const proj = t.project_reference ? `projeto=${t.project_reference}` : '';
      lines.push(`- [${t.id}] "${t.title}" | status=${t.status} | ${due} | ${resp} ${proj} | inbox=${t.inbox_item_id} | created=${t.created_at}`);
    }
  } else {
    lines.push('TASKS ATIVAS: nenhuma');
  }

  return lines.join('\n');
}

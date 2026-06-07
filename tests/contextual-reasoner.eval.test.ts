/**
 * Eval suite para o Contextual Reasoner.
 *
 * Estes testes rodam CONTRA o LLM real (gpt-4o-mini) quando
 * RUN_OPENAI_INTEGRATION_TESTS=true + OPENAI_API_KEY presente.
 *
 * Por padrão (sem flag), são SKIPPED — só servem como documentação
 * dos cenários canônicos que o Reasoner tem que acertar.
 *
 * Para rodar localmente:
 *   RUN_OPENAI_INTEGRATION_TESTS=true OPENAI_API_KEY=sk-... npm test -- contextual-reasoner.eval
 */
import { describe, expect, it } from 'vitest';
import { createContextualReasonerService } from '../src/services/contextual-reasoner.service.js';
import type { ReasonInput, ReasonOutput } from '../src/services/contextual-reasoner.types.js';
import { isOpenAiIntegrationEnabled } from '../src/config/env.js';

const ENABLED = isOpenAiIntegrationEnabled();
const describeIf = ENABLED ? describe : describe.skip;

const svc = ENABLED ? createContextualReasonerService() : null;

function makeInput(partial: Partial<ReasonInput> = {}): ReasonInput {
  return {
    currentMessage: 'oi',
    channel: 'telegram',
    receivedAt: '2026-06-07T10:00:00Z',
    timezone: 'America/Sao_Paulo',
    pendingClarifications: [],
    threadContext: {
      thread_id: 'telegram:5991664193',
      recentMessages: [],
      salientEntities: [],
    },
    activeTasks: [],
    ...partial,
  };
}

// ============================================================================
// CENÁRIOS CANÔNICOS — baseados em runs reais do Wellerson
// ============================================================================

describeIf('Contextual Reasoner — eval suite (LLM real)', () => {
  // --------------------------------------------------------------------------
  // C1: pure new capture (sem clarifs/tasks) — Few-shot 3
  // --------------------------------------------------------------------------
  it('C1: pure new capture', async () => {
    const out = await svc!.reason(
      makeInput({ currentMessage: 'ideia: app de pomodoro com integração ao notion' }),
    );
    expect(out.decision.kind).toBe('new_capture');
    expect(out.clarif_resolutions).toHaveLength(0);
    expect(out.task_updates).toHaveLength(0);
    expect(out.new_capture).not.toBeNull();
  });

  // --------------------------------------------------------------------------
  // C2: unrelated (small talk)
  // --------------------------------------------------------------------------
  it('C2: unrelated (small talk)', async () => {
    const out = await svc!.reason(makeInput({ currentMessage: 'oi' }));
    expect(out.decision.kind).toBe('unrelated');
    expect(out.new_capture).toBeNull();
  });

  // --------------------------------------------------------------------------
  // C3: J1 — sub-task herda prazo do pai (bug que motivou Fase 5)
  // --------------------------------------------------------------------------
  it('C3: J1 — sub-task herda prazo do pai (prazo repetido)', async () => {
    const out = await svc!.reason(
      makeInput({
        currentMessage:
          'Eu mesmo vou corrigir, são melhorias no âmbito de produto. Que terei que codar.',
        pendingClarifications: [
          {
            id: 'clf_1',
            question: 'Quem será o responsável por corrigir os pontos do projeto Miranda?',
            issue_type: 'missing_assignee',
            target_reference: 'responsável',
            suggested_answers: ['Eu (você)', 'Cátia', 'Outra pessoa'],
            source_excerpt: 'preciso lembrar de corrigir os pontos levantados pela Cátia',
            inbox_item_id: '55555555-5555-4555-8555-555555555555',
          },
        ],
        threadContext: {
          thread_id: 'telegram:5991664193',
          recentMessages: [
            {
              inbox_item_id: '66666666-6666-4666-8666-666666666666',
              raw_content:
                'Websummit começa amanhã, dia 08 de junho e termina dia 11. Sobre corrigir os pontos do projeto Miranda, pretendo acabar hoje mesmo.',
              created_at: '2026-06-07T10:54:00Z',
            },
          ],
          salientEntities: [
            { reference: 'Cátia', canonicalName: null, entityType: 'person' },
            { reference: 'Miranda', canonicalName: 'Projeto Miranda', entityType: 'project' },
          ],
        },
        activeTasks: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            title: 'Corrigir os pontos do projeto Miranda',
            status: 'open',
            due_at: '2026-06-07',
            assignee_reference: null,
            project_reference: 'Miranda',
            inbox_item_id: '66666666-6666-4666-8666-666666666666',
            created_at: '2026-06-07T10:54:00Z',
          },
        ],
      }),
    );
    // Decision: mixed (responde clarif + tem conteúdo novo)
    expect(out.decision.kind).toMatch(/mixed|update_existing/);
    // Resposta da clarif "Quem"
    expect(out.clarif_resolutions).toHaveLength(1);
    expect(out.clarif_resolutions[0].answered).toBe(true);
    expect(out.clarif_resolutions[0].answer?.toLowerCase()).toContain('eu');
    // NÃO deve criar clarif de prazo (J1 fix)
    expect(out.new_clarifications.find((c) => c.target_reference.toLowerCase().includes('prazo'))).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // C4: J3 — responde 2 clarifs de uma vez (bug que motivou Fase 5)
  // --------------------------------------------------------------------------
  it('C4: J3 — responde 2 clarifs de uma vez', async () => {
    const out = await svc!.reason(
      makeInput({
        currentMessage:
          'Websummit começa amanhã, dia 08 de junho e termina dia 11. Inclusive enviarei muitas coisas relacionadas ao websummit para que você registre. Mas só voltarei do Rio dia 14. A lari chega no rio dia 12 e estaremos juntos até dia 14 quando voltaremos a BH. Sobre corrigir os pontos do projeto Miranda, pretendo acabar hoje mesmo.',
        pendingClarifications: [
          {
            id: 'clf_websummit',
            question: 'Qual a data de "Estar no Rio pela Websummit"?',
            issue_type: 'missing_due_date',
            target_reference: 'Estar no Rio pela Websummit',
            suggested_answers: [],
            source_excerpt: 'estará no Rio essa semana pela liquid assim como eu estarei pela velt',
            inbox_item_id: '55555555-5555-4555-8555-555555555555',
          },
          {
            id: 'clf_miranda',
            question: 'Para "Corrigir os pontos do projeto Miranda": qual o prazo?',
            issue_type: 'missing_due_date',
            target_reference: 'Corrigir os pontos do projeto Miranda',
            suggested_answers: [],
            source_excerpt: 'preciso lembrar de corrigir os pontos levantados pela Cátia',
            inbox_item_id: '55555555-5555-4555-8555-555555555555',
          },
        ],
        threadContext: {
          thread_id: 'telegram:5991664193',
          recentMessages: [
            {
              inbox_item_id: '55555555-5555-4555-8555-555555555555',
              raw_content:
                'Ok. Preciso lembrar de corrigir os pontos levantados pela Cátia com relação ao projeto Miranda. O projeto Miranda é um app de gestão para brechós...',
              created_at: '2026-06-07T10:51:00Z',
            },
          ],
          salientEntities: [
            { reference: 'Cátia', canonicalName: null, entityType: 'person' },
            { reference: 'Miranda', canonicalName: 'Projeto Miranda', entityType: 'project' },
            { reference: 'Lari', canonicalName: 'Larisse do Carmo Peixoto', entityType: 'person' },
          ],
        },
        activeTasks: [
          {
            id: '22222222-2222-2222-2222-222222222222',
            title: 'Corrigir os pontos do projeto Miranda',
            status: 'open',
            due_at: null,
            assignee_reference: null,
            project_reference: 'Miranda',
            inbox_item_id: '55555555-5555-4555-8555-555555555555',
            created_at: '2026-06-07T10:51:00Z',
          },
        ],
      }),
    );
    // Decision: mixed ou pure_reply (responde as 2 pendentes)
    expect(out.decision.kind).toMatch(/mixed|pure_reply/);
    // Resolve as 2 clarifs
    expect(out.clarif_resolutions).toHaveLength(2);
    expect(out.clarif_resolutions.every((r) => r.answered)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // C5: cancel (Few-shot 4)
  // --------------------------------------------------------------------------
  it('C5: cancel de task ativa', async () => {
    const out = await svc!.reason(
      makeInput({
        currentMessage: 'esquece, desisti do app de pomodoro',
        activeTasks: [
          {
            id: '33333333-3333-3333-3333-333333333333',
            title: 'App de pomodoro com Notion',
            status: 'open',
            due_at: null,
            assignee_reference: null,
            project_reference: null,
            inbox_item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            created_at: '2026-06-01T10:00:00Z',
          },
        ],
      }),
    );
    expect(out.decision.kind).toBe('cancel_pending');
    expect(out.task_updates).toHaveLength(1);
    expect(out.task_updates[0].operation).toBe('cancel');
  });

  // --------------------------------------------------------------------------
  // C6: update_existing — "na verdade o prazo é amanhã" (sobrescreve)
  // --------------------------------------------------------------------------
  it('C6: update existing task (mudou prazo)', async () => {
    const out = await svc!.reason(
      makeInput({
        currentMessage: 'na verdade o prazo das correções do Miranda é amanhã, não hoje',
        threadContext: {
          thread_id: 'telegram:5991664193',
          recentMessages: [
            {
              inbox_item_id: '66666666-6666-4666-8666-666666666666',
              raw_content:
                'Sobre corrigir os pontos do projeto Miranda, pretendo acabar hoje mesmo.',
              created_at: '2026-06-07T10:54:00Z',
            },
          ],
          salientEntities: [],
        },
        activeTasks: [
          {
            id: '44444444-4444-4444-4444-444444444444',
            title: 'Corrigir os pontos do projeto Miranda',
            status: 'open',
            due_at: '2026-06-07',
            assignee_reference: 'Wellerson',
            project_reference: 'Miranda',
            inbox_item_id: '66666666-6666-4666-8666-666666666666',
            created_at: '2026-06-07T10:54:00Z',
          },
        ],
      }),
    );
    expect(out.decision.kind).toMatch(/update_existing|mixed/);
    expect(out.task_updates.some((u) => u.operation === 'update_due_date')).toBe(true);
  });

  // --------------------------------------------------------------------------
  // C7: mixed — resolve clarif + adiciona conteúdo novo
  // --------------------------------------------------------------------------
  it('C7: mixed — resolve clarif + novo entity', async () => {
    const out = await svc!.reason(
      makeInput({
        currentMessage: 'Gabriel Xavier, pode adicionar ele na lista. Ele é meu primo.',
        pendingClarifications: [
          {
            id: 'clf_gabriel',
            question: 'Quem é Gabriel Xavier?',
            issue_type: 'ambiguous_identity',
            target_reference: 'Gabriel Xavier',
            suggested_answers: [],
            source_excerpt: 'Conversei com o Gabriel Xavier ontem',
            inbox_item_id: '77777777-7777-4777-8777-777777777777',
          },
        ],
      }),
    );
    expect(out.decision.kind).toBe('mixed');
    expect(out.clarif_resolutions[0].answered).toBe(true);
    expect(out.new_capture).not.toBeNull();
  });

  // --------------------------------------------------------------------------
  // C8: sem clarifs + sem contexto + msg complexa = new_capture
  // --------------------------------------------------------------------------
  it('C8: msg complexa sem contexto', async () => {
    const out = await svc!.reason(
      makeInput({
        currentMessage:
          'Reunião com Breno e Lari amanhã 14h no escritório da Brant. Discutir roadmap Q3.',
      }),
    );
    expect(out.decision.kind).toBe('new_capture');
  });

  // --------------------------------------------------------------------------
  // C9: pending clarif + msg que NÃO responde (irrelevante)
  // --------------------------------------------------------------------------
  it('C9: msg irrelevante não deve "responder" clarif pendente', async () => {
    const out = await svc!.reason(
      makeInput({
        currentMessage: 'gastei 50 reais no almoço',
        pendingClarifications: [
          {
            id: 'clf_breno',
            question: 'Quem é o Breno?',
            issue_type: 'ambiguous_identity',
            target_reference: 'Breno',
            suggested_answers: [],
            source_excerpt: 'reunião com Breno',
            inbox_item_id: '88888888-8888-4888-8888-888888888888',
          },
        ],
      }),
    );
    // Decisão não deve ser pure_reply (msg não responde a clarif)
    expect(out.decision.kind).not.toBe('pure_reply');
  });

  // --------------------------------------------------------------------------
  // C10: thread continuation (sem clarif, mas task ativa relacionada)
  // --------------------------------------------------------------------------
  it('C10: thread continuation — msg adiciona info a task ativa', async () => {
    const out = await svc!.reason(
      makeInput({
        currentMessage: 'combinei com o Breno, vai ser quinta às 15h',
        activeTasks: [
          {
            id: '55555555-5555-5555-5555-555555555555',
            title: 'Reunião com Breno',
            status: 'open',
            due_at: null,
            assignee_reference: 'Wellerson',
            project_reference: null,
            inbox_item_id: '99999999-9999-4999-8999-999999999999',
            created_at: '2026-06-06T10:00:00Z',
          },
        ],
      }),
    );
    // Pode ser new_capture OU update_existing OU mixed. Não deve ser unrelated/pure_reply.
    expect(out.decision.kind).not.toBe('unrelated');
    expect(out.decision.kind).not.toBe('pure_reply');
  });
});

// ============================================================================
// Sanity checks via mock (rodam SEM LLM real, sempre)
// ============================================================================

describe('Contextual Reasoner — sanity checks (mock-based, always runs)', () => {
  it('safe_fallback: nunca lança erro, sempre retorna ReasonOutput', async () => {
    const { ContextualReasonerService } = await import(
      '../src/services/contextual-reasoner.service.js'
    );
    const { makeReasonInput } = await import('./helpers/reasoner-fixtures.js');
    const failingClient = {
      completeJson: async () => {
        throw new Error('API down');
      },
    };
    const svc = new ContextualReasonerService(failingClient as never);
    const out = await svc.reason(makeReasonInput({}));
    expect(out).toBeDefined();
    expect(out.decision.kind).toBe('new_capture');
  });
});

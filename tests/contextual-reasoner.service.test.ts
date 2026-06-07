import { describe, expect, it, vi } from 'vitest';
import {
  ContextualReasonerService,
  parseReasonerLlmResponse,
  sanityCheckReasonerOutput,
  type ReasonerLlmClient,
  type ReasonerLlmResult,
} from '../src/services/contextual-reasoner.service.js';
import {
  SAFE_FALLBACK_REASONER_OUTPUT,
  emptyReasonInput,
  makeReasonInput,
} from './helpers/reasoner-fixtures.js';

const mockOk = (content: string): ReasonerLlmResult => ({
  content,
  finish_reason: 'stop',
  model: 'gpt-4o-mini',
  input_tokens: 100,
  output_tokens: 50,
});

const mockClient = (result: ReasonerLlmResult): ReasonerLlmClient => ({
  completeJson: vi.fn().mockResolvedValue(result),
});

const mockThrowingClient = (err: Error): ReasonerLlmClient => ({
  completeJson: vi.fn().mockRejectedValue(err),
});

describe('parseReasonerLlmResponse', () => {
  it('parseia output válido', () => {
    const raw = JSON.stringify({
      decision: { kind: 'new_capture', confidence: 0.9, reasoning: 'msg simples' },
      clarif_resolutions: [],
      task_updates: [],
      new_capture: { effective_input: 'oi', summary: 'saudação' },
      new_clarifications: [],
    });
    const parsed = parseReasonerLlmResponse(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.decision.kind).toBe('new_capture');
  });

  it('retorna null pra JSON inválido', () => {
    const parsed = parseReasonerLlmResponse('not json {');
    expect(parsed).toBeNull();
  });

  it('retorna null pra JSON que não casa com schema', () => {
    const parsed = parseReasonerLlmResponse(JSON.stringify({ foo: 'bar' }));
    expect(parsed).toBeNull();
  });

  it('retorna null se decision.kind é inválido', () => {
    const raw = JSON.stringify({
      decision: { kind: 'invalid_kind', confidence: 0.5, reasoning: 'x' },
      clarif_resolutions: [],
      task_updates: [],
      new_capture: null,
      new_clarifications: [],
    });
    const parsed = parseReasonerLlmResponse(raw);
    expect(parsed).toBeNull();
  });
});

describe('sanityCheckReasonerOutput', () => {
  const baseInput = makeReasonInput({
    pendingClarifications: [
      {
        id: 'clf_1',
        question: 'Q1',
        issue_type: 'other',
        target_reference: 'ref1',
        suggested_answers: [],
        source_excerpt: 'ex',
        inbox_item_id: 'inb_1',
      },
    ],
  });

  it('dropa clarif_resolution com clarification_id não pendente', () => {
    const input = baseInput;
    const output = {
      decision: { kind: 'mixed' as const, confidence: 0.9, reasoning: 'x' },
      clarif_resolutions: [
        { clarification_id: 'clf_FAKE', answered: true, answer: 'sim', confidence: 0.9 },
      ],
      task_updates: [],
      new_capture: { effective_input: 'x', summary: 's' },
      new_clarifications: [],
    };
    const checked = sanityCheckReasonerOutput(output, input);
    expect(checked.clarif_resolutions).toHaveLength(0);
  });

  it('dropa task_update com task_id não ativo', () => {
    const input = baseInput; // activeTasks: []
    const output = {
      decision: { kind: 'cancel_pending' as const, confidence: 0.9, reasoning: 'x' },
      clarif_resolutions: [],
      task_updates: [
        {
          task_id: 'task_FAKE',
          operation: 'cancel' as const,
          new_value: null,
          inherit_from_parent: false,
          parent_task_id: null,
          reasoning: 'x',
        },
      ],
      new_capture: null,
      new_clarifications: [],
    };
    const checked = sanityCheckReasonerOutput(output, input);
    expect(checked.task_updates).toHaveLength(0);
  });

  it('corrige decision.kind new_capture → mixed se há resolution answered=true', () => {
    const input = baseInput;
    const output = {
      decision: { kind: 'new_capture' as const, confidence: 0.9, reasoning: 'x' },
      clarif_resolutions: [
        { clarification_id: 'clf_1', answered: true, answer: 'sim', confidence: 0.9 },
      ],
      task_updates: [],
      new_capture: null,
      new_clarifications: [],
    };
    const checked = sanityCheckReasonerOutput(output, input);
    expect(checked.decision.kind).toBe('mixed');
  });

  it('limpa new_capture e new_clarifications se decision.kind é unrelated', () => {
    const input = baseInput;
    const output = {
      decision: { kind: 'unrelated' as const, confidence: 0.9, reasoning: 'x' },
      clarif_resolutions: [],
      task_updates: [],
      new_capture: { effective_input: 'x', summary: 's' },
      new_clarifications: [
        {
          question: 'q',
          target_reference: 'r',
          issue_type: 'other',
          suggested_answers: [],
          priority: 50,
          reasoning: 'x',
        },
      ],
    };
    const checked = sanityCheckReasonerOutput(output, input);
    expect(checked.new_capture).toBeNull();
    expect(checked.new_clarifications).toHaveLength(0);
  });

  it('dropa new_clarification com issue_type inválido', () => {
    const input = baseInput;
    const output = {
      decision: { kind: 'new_capture' as const, confidence: 0.9, reasoning: 'x' },
      clarif_resolutions: [],
      task_updates: [],
      new_capture: { effective_input: 'x', summary: 's' },
      new_clarifications: [
        {
          question: 'q',
          target_reference: 'r',
          issue_type: 'INVALID_TYPE',
          suggested_answers: [],
          priority: 50,
          reasoning: 'x',
        },
      ],
    };
    const checked = sanityCheckReasonerOutput(output, input);
    expect(checked.new_clarifications).toHaveLength(0);
  });
});

describe('ContextualReasonerService.reason', () => {
  it('retorna SAFE_FALLBACK se LLM der erro', async () => {
    const svc = new ContextualReasonerService(mockThrowingClient(new Error('timeout')));
    const out = await svc.reason(makeReasonInput({}));
    expect(out.decision.kind).toBe('new_capture');
    expect(out.decision.confidence).toBeLessThan(0.5);
  });

  it('retorna SAFE_FALLBACK se parse falhar', async () => {
    const svc = new ContextualReasonerService(mockClient(mockOk('not json')));
    const out = await svc.reason(makeReasonInput({}));
    expect(out.decision.kind).toBe('new_capture');
    expect(out.decision.confidence).toBeLessThan(0.5);
  });

  it('retorna unrelated sem chamar LLM se msg trivial sem contexto', async () => {
    const client = mockClient(mockOk('ignored'));
    const svc = new ContextualReasonerService(client);
    const out = await svc.reason(emptyReasonInput({ currentMessage: 'oi' }));
    expect(out.decision.kind).toBe('unrelated');
    expect(client.completeJson).not.toHaveBeenCalled();
  });

  it('chama LLM e parseia output válido', async () => {
    const valid = JSON.stringify({
      decision: { kind: 'new_capture', confidence: 0.95, reasoning: 'msg simples' },
      clarif_resolutions: [],
      task_updates: [],
      new_capture: { effective_input: 'ideia: app pomodoro', summary: 'ideia nova' },
      new_clarifications: [],
    });
    const svc = new ContextualReasonerService(mockClient(mockOk(valid)));
    const out = await svc.reason(makeReasonInput({}));
    expect(out.decision.kind).toBe('new_capture');
    expect(out.new_capture?.effective_input).toBe('ideia: app pomodoro');
  });

  it('rejeita input inválido via Zod e retorna SAFE_FALLBACK', async () => {
    const svc = new ContextualReasonerService(mockClient(mockOk('{}')));
    const badInput = {
      currentMessage: '', // empty — Zod should reject
      channel: 'telegram' as const,
      receivedAt: '2026-06-07T00:00:00Z',
      timezone: 'America/Sao_Paulo',
      pendingClarifications: [],
      threadContext: { thread_id: 't1', recentMessages: [], salientEntities: [] },
      activeTasks: [],
    };
    const out = await svc.reason(badInput);
    expect(out.decision.kind).toBe('new_capture');
    expect(out.decision.confidence).toBeLessThan(0.5);
  });
});

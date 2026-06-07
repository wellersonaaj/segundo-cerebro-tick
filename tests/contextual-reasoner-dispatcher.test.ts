import { describe, expect, it, vi } from 'vitest';
import { ContextualReasonerDispatcher } from '../src/services/contextual-reasoner-dispatcher.service.js';
import type { ClarificationService } from '../src/services/clarification.service.js';
import type { ClarificationsRepository } from '../src/repositories/clarifications.repository.js';
import type { InboxItemsRepository } from '../src/repositories/inbox-items.repository.js';
import type { TasksRepository } from '../src/repositories/tasks.repository.js';
import type { InboxItemProcessService } from '../src/services/inbox-item-process.service.js';
import type { ReasonInput, ReasonOutput } from '../src/services/contextual-reasoner.types.js';

const baseOutput: ReasonOutput = {
  decision: { kind: 'unrelated', confidence: 0.9, reasoning: 'r' },
  clarif_resolutions: [],
  task_updates: [],
  new_capture: null,
  new_clarifications: [],
};

const baseInput: ReasonInput = {
  currentMessage: 'oi',
  channel: 'telegram',
  receivedAt: '2026-06-07T10:00:00Z',
  timezone: 'America/Sao_Paulo',
  pendingClarifications: [],
  threadContext: { thread_id: 't1', recentMessages: [], salientEntities: [] },
  activeTasks: [],
};

function makeDeps(overrides: Partial<{
  resolveAndApply: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  processById: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    clarificationService: {
      resolveAndApply: overrides.resolveAndApply ?? vi.fn().mockResolvedValue({}),
    } as unknown as ClarificationService,
    clarificationsRepo: {
      findById: overrides.findById ?? vi.fn().mockResolvedValue({
        id: 'clf_1',
        status: 'pending',
        question: 'q',
        suggested_answers: [],
        inbox_item_id: 'inb_1',
      }),
    } as unknown as ClarificationsRepository,
    inboxRepo: {} as InboxItemsRepository,
    tasksRepo: null,
    v14Process: {
      processById: overrides.processById ?? vi.fn().mockResolvedValue({}),
    } as unknown as InboxItemProcessService,
  };
}

describe('ContextualReasonerDispatcher', () => {
  it('unrelated → skip', async () => {
    const d = new ContextualReasonerDispatcher(makeDeps());
    const out = await d.dispatch({ inboxId: 'inb_1', reasonOutput: baseOutput, reasonInput: baseInput, mode: 'act' });
    expect(out.skippedAsUnrelated).toBe(true);
    expect(out.clarifsResolved).toBe(0);
  });

  it('pure_reply em act mode resolve clarif_resolutions', async () => {
    const resolveAndApply = vi.fn().mockResolvedValue({});
    const d = new ContextualReasonerDispatcher(makeDeps({ resolveAndApply }));
    const reasonOutput: ReasonOutput = {
      ...baseOutput,
      decision: { kind: 'pure_reply', confidence: 0.95, reasoning: 'r' },
      clarif_resolutions: [{ clarification_id: 'clf_1', answered: true, answer: 'sim', confidence: 0.9 }],
    };
    const out = await d.dispatch({ inboxId: 'inb_1', reasonOutput, reasonInput: baseInput, mode: 'act' });
    expect(out.clarifsResolved).toBe(1);
    expect(resolveAndApply).toHaveBeenCalledWith('clf_1', 'sim', { apply: true });
  });

  it('pure_reply em shadow mode NÃO resolve', async () => {
    const resolveAndApply = vi.fn().mockResolvedValue({});
    const d = new ContextualReasonerDispatcher(makeDeps({ resolveAndApply }));
    const reasonOutput: ReasonOutput = {
      ...baseOutput,
      decision: { kind: 'pure_reply', confidence: 0.95, reasoning: 'r' },
      clarif_resolutions: [{ clarification_id: 'clf_1', answered: true, answer: 'sim', confidence: 0.9 }],
    };
    const out = await d.dispatch({ inboxId: 'inb_1', reasonOutput, reasonInput: baseInput, mode: 'shadow' });
    expect(out.clarifsResolved).toBe(0);
    expect(resolveAndApply).not.toHaveBeenCalled();
  });

  it('cancel_pending marca awaitingConfirmation (não cancela direto)', async () => {
    const tasksRepo = {
      listActiveByInboxItemIds: vi.fn().mockResolvedValue([
        { id: '00000000-0000-4000-8000-000000000000' } as never,
      ]),
    };
    const d = new ContextualReasonerDispatcher({ ...makeDeps(), tasksRepo });
    const reasonOutput: ReasonOutput = {
      ...baseOutput,
      decision: { kind: 'cancel_pending', confidence: 0.9, reasoning: 'r' },
      task_updates: [{
        task_id: '00000000-0000-4000-8000-000000000000',
        operation: 'cancel',
        new_value: null,
        inherit_from_parent: false,
        parent_task_id: null,
        reasoning: 'x',
      }],
    };
    const out = await d.dispatch({ inboxId: 'inb_1', reasonOutput, reasonInput: baseInput, mode: 'act' });
    expect(out.awaitingConfirmation).toBe(true);
  });

  it('erro em resolveAndApply não bloqueia dispatcher', async () => {
    const resolveAndApply = vi.fn().mockRejectedValue(new Error('db down'));
    const d = new ContextualReasonerDispatcher(makeDeps({ resolveAndApply }));
    const reasonOutput: ReasonOutput = {
      ...baseOutput,
      decision: { kind: 'pure_reply', confidence: 0.95, reasoning: 'r' },
      clarif_resolutions: [{ clarification_id: 'clf_1', answered: true, answer: 'sim', confidence: 0.9 }],
    };
    const out = await d.dispatch({ inboxId: 'inb_1', reasonOutput, reasonInput: baseInput, mode: 'act' });
    expect(out.clarifsResolved).toBe(0);
    // Não deve ter lançado
  });
});

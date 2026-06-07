import type { ReasonInput, ReasonOutput } from '../src/services/contextual-reasoner.types.js';

export const SAFE_FALLBACK_REASONER_OUTPUT: ReasonOutput = {
  decision: {
    kind: 'new_capture',
    confidence: 0.4,
    reasoning: 'fallback seguro: erro no reasoner, segue com new_capture',
  },
  clarif_resolutions: [],
  task_updates: [],
  new_capture: null,
  new_clarifications: [],
};

export function emptyReasonInput(overrides: Partial<ReasonInput> = {}): ReasonInput {
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
    ...overrides,
  };
}

export function makeReasonInput(overrides: Partial<ReasonInput> = {}): ReasonInput {
  return {
    currentMessage: 'ideia: app de pomodoro com integração ao notion',
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
    ...overrides,
  };
}

import type { AssistantTurnRecord, AssistantTurnStatus } from './assistant-turn.types.js';

const turns = new Map<string, AssistantTurnRecord>();

export function createAssistantTurn(
  record: Omit<AssistantTurnRecord, 'follow_up_message' | 'inbox_item_id' | 'extraction_run_id' | 'error' | 'completed_at'>,
): AssistantTurnRecord {
  const full: AssistantTurnRecord = {
    ...record,
    follow_up_message: null,
    inbox_item_id: null,
    extraction_run_id: null,
    error: null,
    completed_at: null,
  };
  turns.set(record.turn_id, full);
  return full;
}

export function getAssistantTurn(turnId: string): AssistantTurnRecord | null {
  return turns.get(turnId) ?? null;
}

export function updateAssistantTurn(
  turnId: string,
  patch: Partial<
    Pick<
      AssistantTurnRecord,
      | 'status'
      | 'follow_up_message'
      | 'inbox_item_id'
      | 'extraction_run_id'
      | 'error'
      | 'completed_at'
    >
  >,
): AssistantTurnRecord | null {
  const current = turns.get(turnId);
  if (!current) return null;
  const next = { ...current, ...patch };
  turns.set(turnId, next);
  return next;
}

export function setAssistantTurnStatus(
  turnId: string,
  status: AssistantTurnStatus,
  fields?: Partial<
    Pick<
      AssistantTurnRecord,
      'follow_up_message' | 'inbox_item_id' | 'extraction_run_id' | 'error' | 'completed_at'
    >
  >,
): AssistantTurnRecord | null {
  return updateAssistantTurn(turnId, {
    status,
    completed_at: status === 'processing' ? null : new Date().toISOString(),
    ...fields,
  });
}

/** Test helper — clears in-memory turn state. */
export function clearAssistantTurnStore(): void {
  turns.clear();
}

import { describe, expect, it } from 'vitest';
import {
  resolveTaskReferenceAgainstContext,
  TASK_RESOLVE_MIN_SCORE,
  TASK_RESOLVE_SCORE_MARGIN,
} from '../src/services/task-context-resolver.service.js';
import type { TaskContext } from '../src/types/ingestion-context.js';

const singleTask: TaskContext[] = [
  {
    id: 't1',
    reference: 'Revisar contrato',
    normalizedReference: 'revisar contrato',
    threadReferences: ['thread-atlas-1'],
  },
];

const twoTasks: TaskContext[] = [
  {
    id: 'a',
    reference: 'Revisar contrato fornecedor A',
    normalizedReference: 'revisar contrato fornecedor a',
    threadReferences: ['thread-reviews'],
  },
  {
    id: 'b',
    reference: 'Revisar contrato fornecedor B',
    normalizedReference: 'revisar contrato fornecedor b',
    threadReferences: ['thread-reviews'],
  },
];

describe('TaskContextResolver scoring', () => {
  it('resolves unique match with score and margin', () => {
    const out = resolveTaskReferenceAgainstContext('revisão', singleTask, {
      thread_reference: 'thread-atlas-1',
    });
    expect(out.status).toBe('resolved');
    expect(out.bestScore).toBeGreaterThanOrEqual(TASK_RESOLVE_MIN_SCORE);
    expect(out.candidateCountBeforeTruncation).toBe(1);
    expect(out.resolutionReason).toBe('score_above_margin');
  });

  it('ambiguous when two close candidates before truncation', () => {
    const out = resolveTaskReferenceAgainstContext('revisão', twoTasks, {
      thread_reference: 'thread-reviews',
    });
    expect(out.status).toBe('ambiguous');
    expect(out.candidateCountBeforeTruncation).toBe(2);
    expect(out.candidates?.length).toBeGreaterThan(1);
    if (out.secondBestScore != null) {
      expect(out.scoreMargin).toBeLessThan(TASK_RESOLVE_SCORE_MARGIN);
    }
  });

  it('explicit reference resolves without ambiguous truncation trap', () => {
    const out = resolveTaskReferenceAgainstContext('Revisar contrato', singleTask, {});
    expect(out.status).toBe('resolved');
    expect(out.resolutionSource).toBe('explicit_reference');
  });
});

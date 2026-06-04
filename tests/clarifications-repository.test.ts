import { describe, expect, it, vi } from 'vitest';
import { ClarificationsRepository } from '../src/repositories/clarifications.repository.js';
import type { ExtractedClarification } from '../src/types/domain.js';

describe('ClarificationsRepository.createManyCandidates', () => {
  it('includes normalized_target_reference on every insert row', async () => {
    const insertedRows: Record<string, unknown>[] = [];
    const db = {
      from: () => ({
        insert: (rows: Record<string, unknown>[]) => {
          insertedRows.push(...rows);
          return {
            select: async () => ({ data: rows.map((r, i) => ({ id: `cl-${i}`, ...r })), error: null }),
          };
        },
      }),
    };

    const repo = new ClarificationsRepository(db as never);
    const items: ExtractedClarification[] = [
      {
        target_type: 'entity',
        target_reference: 'ele',
        issue_type: 'ambiguous_identity',
        question: "Quem é 'ele'?",
        reason: 'test',
        priority: 'medium',
        blocking_scope: 'none',
        suggested_answers: ['Breno'],
        source_excerpt: 'almocemos com ele',
      },
    ];

    await repo.createManyCandidates('inbox-1', 'run-1', items);

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]?.normalized_target_reference).toBe('ele');
    expect(insertedRows[0]?.target_reference).toBe('ele');
  });
});

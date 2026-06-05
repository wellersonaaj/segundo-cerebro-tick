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
    expect(insertedRows[0]?.materiality).toBe('non_blocking');
  });

  it('sets materiality blocking for external_action scope', async () => {
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
    await repo.createManyCandidates('inbox-1', 'run-1', [
      {
        target_type: 'event',
        target_reference: 'consulta',
        issue_type: 'missing_date',
        question: 'Quando?',
        reason: 'test',
        priority: 'high',
        blocking_scope: 'external_action',
        suggested_answers: [],
        source_excerpt: 'consulta',
      },
    ]);

    expect(insertedRows[0]?.materiality).toBe('blocking');
  });
});

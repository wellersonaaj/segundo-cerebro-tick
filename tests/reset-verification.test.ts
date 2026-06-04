import { describe, expect, it } from 'vitest';
import {
  evaluateResetCounts,
  FLOW_TABLES,
  isBlockedProductionTarget,
} from '../scripts/lib/reset-verification.js';

describe('reset verification', () => {
  it('passes when flow tables empty and Genius seed present', () => {
    const counts = [
      ...FLOW_TABLES.map((table) => ({ table, count: 0 })),
      { table: 'entities', count: 1 },
      { table: 'entity_aliases', count: 1 },
      { table: 'tasks', count: 0 },
    ];
    const result = evaluateResetCounts(counts, { geniusSeedExpected: true });
    expect(result.ok).toBe(true);
  });

  it('fails when inbox_extraction_runs remain', () => {
    const counts = [
      ...FLOW_TABLES.map((table) => ({
        table,
        count: table === 'inbox_extraction_runs' ? 2 : 0,
      })),
      { table: 'entities', count: 1 },
      { table: 'entity_aliases', count: 1 },
      { table: 'tasks', count: 0 },
    ];
    const result = evaluateResetCounts(counts, { geniusSeedExpected: true });
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.includes('inbox_extraction_runs'))).toBe(true);
  });

  it('blocks production NODE_ENV', () => {
    expect(isBlockedProductionTarget('https://homolog.supabase.co', 'production')).toMatch(/production/);
  });
});
